import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { emptyTrip } from "../shared/formats";
import {
  bookingSiteUrl,
  nightlyRange,
  normaliseUrl,
  overnights,
  stayBudget,
  stayDates,
  type Overnight,
} from "../shared/stays";
import type { Place, RoutePlan } from "../shared/types";

// Overpass is mocked: a hotel 1 km north of Beaufort West, an unnamed guest house and a museum.
let lastQuery = "";
vi.mock("../server/services/overpass", async (orig) => {
  const real = await orig<typeof import("../server/services/overpass")>();
  return {
    ...real,
    overpass: vi.fn(async (query: string) => {
      lastQuery = query;
      return [
        { type: "node", id: 1, lat: -32.347, lon: 22.583, tags: { tourism: "hotel", name: "Wagon Wheel", stars: "3", website: "wagonwheel.example", "addr:city": "Beaufort West" } },
        { type: "way", id: 2, center: { lat: -32.36, lon: 22.59 }, tags: { tourism: "guest_house" } },
        { type: "node", id: 3, lat: -32.356, lon: 22.583, tags: { tourism: "museum", name: "Museum" } },
        { type: "node", id: 4, lat: -33.0, lon: 22.583, tags: { tourism: "hotel", name: "Far away" } },
      ];
    }),
  };
});

const { createApp } = await import("../server/app");
const { openDb } = await import("../server/db");

const H = 3600;
const place = (id: string, extra: Partial<Place> = {}): Place => ({ id, name: id, lat: -32.356, lng: 22.583, ...extra });
const planOf = (legSeconds: number[]): RoutePlan => ({
  order: [],
  legs: legSeconds.map((duration) => ({ distance: duration * 25, duration, geometry: "", steps: [], summary: "" })),
  distance: 0,
  duration: 0,
  optimized: false,
  computedAt: "",
});

describe("overnights", () => {
  const dep = new Date(2026, 11, 16, 7, 0); // 16 Dec 2026 07:00

  it("lists automatic and chosen nights with their dates, then the destination", () => {
    const trip = emptyTrip();
    trip.start = place("start");
    trip.stops = [place("a"), place("b", { overnight: true, nights: 2 }), place("c")];
    trip.end = place("end", { nights: 3 });
    const points = [trip.start, ...trip.stops, trip.end];
    // 6h legs with an 8h limit: sleep at a automatically, then at b (chosen) for two nights
    const list = overnights(trip, planOf([6 * H, 6 * H, 1 * H, 1 * H]), points, dep);
    expect(list.map((o) => [o.place.id, o.checkIn, o.checkOut, o.nights, o.auto, o.destination])).toEqual([
      ["a", "2026-12-16", "2026-12-17", 1, true, false],
      ["b", "2026-12-17", "2026-12-19", 2, false, false],
      ["end", "2026-12-19", "2026-12-22", 3, false, true],
    ]);
  });

  it("skips the destination on round trips and when no nights are set there", () => {
    const trip = emptyTrip();
    trip.start = place("start");
    trip.end = place("end");
    expect(overnights(trip, planOf([H]), [trip.start, trip.end], dep)).toEqual([]);
    trip.end.nights = 2;
    trip.settings.roundTrip = true;
    expect(overnights(trip, planOf([H]), [trip.start, trip.start], dep)).toEqual([]);
  });

  it("counts arrivals in the small hours as the previous night", () => {
    expect(stayDates(new Date(2026, 11, 17, 2, 30), 1)).toEqual(["2026-12-16", "2026-12-17"]);
    expect(stayDates(new Date(2026, 11, 31, 18, 0), 2)).toEqual(["2026-12-31", "2027-01-02"]);
  });
});

describe("accommodation budget", () => {
  const night = (id: string, nights: number, stays?: Place["stays"]): Overnight => ({
    pointIndex: 1,
    place: place(id, { stays }),
    checkIn: "2026-12-16",
    checkOut: "2026-12-17",
    nights,
    auto: false,
    destination: false,
  });

  it("ranges from the cheapest to the dearest saved place, per night", () => {
    expect(nightlyRange([{ id: "1", name: "a", price: 900 }, { id: "2", name: "b", price: 1500 }, { id: "3", name: "c" }])).toEqual({ min: 900, max: 1500 });
    expect(nightlyRange([{ id: "1", name: "a" }])).toBeNull();
    expect(nightlyRange(undefined)).toBeNull();
  });

  it("uses a chosen place's price alone", () => {
    expect(nightlyRange([{ id: "1", name: "a", price: 900 }, { id: "2", name: "b", price: 1500, chosen: true }])).toEqual({ min: 1500, max: 1500 });
    // a pick without a price doesn't narrow the range
    expect(nightlyRange([{ id: "1", name: "a", price: 900 }, { id: "2", name: "b", chosen: true }])).toEqual({ min: 900, max: 900 });
  });

  it("multiplies by nights and reports the nights not priced yet", () => {
    const b = stayBudget([
      night("a", 1, [{ id: "1", name: "x", price: 800 }, { id: "2", name: "y", price: 1200 }]),
      night("b", 2, [{ id: "3", name: "z", price: 1000 }]),
      night("c", 1),
    ]);
    expect(b).toMatchObject({ min: 2800, max: 3200, nights: 4, budgetedNights: 3 });
    expect(b.unbudgeted.map((o) => o.place.id)).toEqual(["c"]);
  });
});

describe("booking site links", () => {
  const q = { query: "Knysna, South Africa", checkIn: "2026-12-16", checkOut: "2026-12-18", adults: 3 };

  it("pre-fills place, dates and party size, with affiliate ids when set", () => {
    const booking = new URL(bookingSiteUrl("booking", q, { booking: "12345" }));
    expect(booking.host).toBe("www.booking.com");
    expect(Object.fromEntries(booking.searchParams)).toMatchObject({ ss: q.query, checkin: q.checkIn, checkout: q.checkOut, group_adults: "3", no_rooms: "1", aid: "12345" });
    const agoda = new URL(bookingSiteUrl("agoda", q, { agoda: "999" }));
    expect(Object.fromEntries(agoda.searchParams)).toMatchObject({ textToSearch: q.query, checkIn: q.checkIn, checkOut: q.checkOut, adults: "3", cid: "999" });
    const airbnb = new URL(bookingSiteUrl("airbnb", q));
    expect(decodeURIComponent(airbnb.pathname)).toBe("/s/Knysna, South Africa/homes");
    expect(Object.fromEntries(airbnb.searchParams)).toEqual({ checkin: q.checkIn, checkout: q.checkOut, adults: "3" });
    expect(new URL(bookingSiteUrl("booking", q)).searchParams.has("aid")).toBe(false);
  });

  it("only lets web links through", () => {
    expect(normaliseUrl("example.co.za/rooms")).toBe("https://example.co.za/rooms");
    expect(normaliseUrl(" http://example.com ")).toBe("http://example.com/");
    expect(normaliseUrl("javascript:alert(1)")).toBeUndefined();
    expect(normaliseUrl("data:text/html,hi")).toBeUndefined();
    expect(normaliseUrl("")).toBeUndefined();
  });
});

describe("POST /api/stays", () => {
  const app = createApp({ db: openDb(":memory:") });

  it("returns named accommodation within the radius, nearest first", async () => {
    const res = await request(app)
      .post("/api/stays")
      .set("X-Padkos", "1")
      .send({ points: [{ id: "bw", lat: -32.356, lng: 22.583 }], radiusKm: 5 })
      .expect(200);
    expect(lastQuery).toContain("around:5000,-32.35600,22.58300");
    expect(res.body.results).toHaveLength(1);
    const { id, stays } = res.body.results[0];
    expect(id).toBe("bw");
    expect(stays).toHaveLength(1);
    expect(stays[0]).toMatchObject({ id: "node/1", name: "Wagon Wheel", kind: "hotel", stars: 3, website: "wagonwheel.example", town: "Beaufort West" });
    expect(stays[0].distance).toBeGreaterThan(900);
    expect(stays[0].distance).toBeLessThan(1100);
  });

  it("rejects points outside South Africa", async () => {
    const res = await request(app).post("/api/stays").set("X-Padkos", "1").send({ points: [{ id: "x", lat: 51.5, lng: -0.1 }], radiusKm: 5 });
    expect(res.status).toBe(400);
  });
});
