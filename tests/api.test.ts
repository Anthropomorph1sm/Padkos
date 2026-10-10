import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { openDb } from "../server/db";
import { encodePolyline, haversine, decodePolyline, type LatLng } from "../shared/geo";
import { emptyTrip } from "../shared/formats";
import type { RoutePlan, Trip } from "../shared/types";

// Stub city lookup: everything within 0.5° of Cape Town is "Cape Town", else "Johannesburg".
const cityLookup = async (lat: number, lng: number) =>
  Math.abs(lat + 33.92) < 0.5 && Math.abs(lng - 18.42) < 0.5
    ? { name: "Cape Town", lat: -33.9249, lng: 18.4241, province: "Western Cape" }
    : { name: "Johannesburg", lat: -26.2041, lng: 28.0473, province: "Gauteng" };

const HOME: LatLng = [-33.95, 18.47]; // a "home address" in Cape Town
const DEST: LatLng = [-26.1, 28.05]; // somewhere in Johannesburg

function sampleTrip(): { trip: Trip; plan: RoutePlan } {
  const trip = emptyTrip();
  trip.title = "Cape to Joburg";
  trip.start = { id: "s", name: "12 Secret Street", address: "12 Secret Street, Rondebosch", lat: HOME[0], lng: HOME[1] };
  trip.end = { id: "e", name: "Auntie's house", lat: DEST[0], lng: DEST[1] };
  trip.stops = [
    { id: "a", name: "Matjiesfontein", lat: -33.23, lng: 20.58, notes: "buy rusks" },
    { id: "b", name: "Friend's farm", lat: -30.5, lng: 25.0, private: true },
  ];
  // a straight-ish fake geometry with many points so trimming is observable
  const pts = (a: LatLng, b: LatLng, n = 200): LatLng[] =>
    Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as LatLng);
  const wps: LatLng[] = [HOME, [-33.23, 20.58], [-30.5, 25.0], DEST];
  const legs = wps.slice(0, -1).map((a, i) => ({
    distance: 400000,
    duration: 15000,
    geometry: encodePolyline(pts(a, wps[i + 1])),
    steps: [
      { instruction: i === 0 ? "Head out on Secret Street" : "Head out", distance: 100, duration: 20, location: a, type: "depart" },
      { instruction: "Arrive", distance: 0, duration: 0, location: wps[i + 1], type: "arrive" },
    ],
    summary: "N1",
  }));
  const plan: RoutePlan = { order: [0, 1], legs, distance: 1200000, duration: 45000, optimized: true, computedAt: new Date().toISOString() };
  return { trip, plan };
}

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  app = createApp({ db: openDb(":memory:"), deps: { cityLookup } });
});

async function signUp(username: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").set("X-Padkos", "1").send({ username, password: "correct horse battery" });
  expect(res.status).toBe(201);
  return agent;
}

describe("auth", () => {
  it("registers, reports me, logs out and back in", async () => {
    const agent = await signUp("thandi");
    expect((await agent.get("/api/auth/me")).body.user.username).toBe("thandi");
    await agent.post("/api/auth/logout").set("X-Padkos", "1").expect(200);
    expect((await agent.get("/api/auth/me")).body.user).toBeNull();
    await agent.post("/api/auth/login").set("X-Padkos", "1").send({ username: "THANDI", password: "nope-nope" }).expect(401);
    await agent.post("/api/auth/login").set("X-Padkos", "1").send({ username: "THANDI", password: "correct horse battery" }).expect(200);
    expect((await agent.get("/api/auth/me")).body.user.username).toBe("thandi");
  });

  it("rejects duplicate usernames and weak passwords", async () => {
    await signUp("pieter");
    const a = request(app);
    await a.post("/api/auth/register").set("X-Padkos", "1").send({ username: "Pieter", password: "long enough pw" }).expect(409);
    const weak = await a.post("/api/auth/register").set("X-Padkos", "1").send({ username: "sipho", password: "short" });
    expect(weak.status).toBe(400);
    expect(weak.body.error).toMatch(/8 characters/);
  });

  it("blocks state-changing requests without the CSRF header", async () => {
    await request(app).post("/api/auth/register").send({ username: "eve", password: "whatever123" }).expect(403);
  });
});

describe("saved routes and privacy", () => {
  it("requires sign-in to save", async () => {
    const { trip, plan } = sampleTrip();
    await request(app).post("/api/routes").set("X-Padkos", "1").send({ trip, plan }).expect(401);
  });

  it("keeps private routes private", async () => {
    const owner = await signUp("owner");
    const { trip, plan } = sampleTrip();
    const created = await owner.post("/api/routes").set("X-Padkos", "1").send({ trip, plan });
    expect(created.status).toBe(201);
    const id = created.body.route.id;
    expect(created.body.route.visibility).toBe("private");
    expect(created.body.route.trip.start.name).toBe("12 Secret Street");
    await request(app).get(`/api/routes/${id}`).expect(404);
    const other = await signUp("nosy");
    await other.get(`/api/routes/${id}`).expect(404);
    expect((await owner.get("/api/routes")).body.routes).toHaveLength(1);
  });

  it("obscures start, end and private stops on public routes", async () => {
    const owner = await signUp("owner");
    const { trip, plan } = sampleTrip();
    const created = await owner.post("/api/routes").set("X-Padkos", "1").send({ trip, plan, visibility: "public" });
    const id = created.body.route.id;

    const view = (await request(app).get(`/api/routes/${id}`).expect(200)).body.route;
    expect(view.obscured).toBe(true);
    expect(view.trip.start).toMatchObject({ name: "Cape Town", lat: -33.9249, lng: 18.4241, kind: "city", approximate: true });
    expect(view.trip.stops[0].approximate).toBeUndefined();
    expect(view.trip.stops[1].approximate).toBe(true);
    expect(view.trip.start.address).toBeUndefined();
    expect(view.trip.end.name).toBe("Johannesburg");
    expect(view.trip.stops[0].name).toBe("Matjiesfontein");
    expect(view.trip.stops[0].notes).toBeUndefined();
    expect(view.trip.stops[1].name).not.toBe("Friend's farm");
    expect(JSON.stringify(view)).not.toContain("Secret Street");
    expect(JSON.stringify(view)).not.toContain("Auntie");
    expect(JSON.stringify(view)).not.toContain("Friend's farm");
    expect(view.startCity).toBe("Cape Town");
    expect(view.endCity).toBe("Johannesburg");

    // geometry never comes within 5 km of the secret points
    const first = decodePolyline(view.plan.legs[0].geometry);
    const last = decodePolyline(view.plan.legs[view.plan.legs.length - 1].geometry);
    for (const p of first) expect(haversine(p, HOME)).toBeGreaterThanOrEqual(5000);
    for (const p of last) expect(haversine(p, DEST)).toBeGreaterThanOrEqual(5000);
    // and the departure step at the home address is gone
    expect(view.plan.legs[0].steps.some((s: { instruction: string }) => s.instruction.includes("Secret"))).toBe(false);

    // the owner still sees everything
    const mine = (await owner.get(`/api/routes/${id}`)).body.route;
    expect(mine.obscured).toBe(false);
    expect(mine.trip.start.name).toBe("12 Secret Street");
  });

  it("serves unlisted routes only via share token", async () => {
    const owner = await signUp("owner");
    const { trip, plan } = sampleTrip();
    const created = (await owner.post("/api/routes").set("X-Padkos", "1").send({ trip, plan, visibility: "unlisted" })).body.route;
    expect(created.shareToken).toBeTruthy();
    await request(app).get(`/api/routes/${created.id}`).expect(404);
    const shared = (await request(app).get(`/api/shared/${created.shareToken}`).expect(200)).body.route;
    expect(shared.trip.start.name).toBe("Cape Town");
    expect(shared.shareToken).toBeUndefined();
    // unlisted routes never appear in the community feed
    expect((await request(app).get("/api/community")).body.routes).toHaveLength(0);
    // rotating the token kills the old link
    const rotated = await owner.post(`/api/routes/${created.id}/share-token`).set("X-Padkos", "1").expect(200);
    await request(app).get(`/api/shared/${created.shareToken}`).expect(404);
    await request(app).get(`/api/shared/${rotated.body.shareToken}`).expect(200);
    // making it private kills share links entirely
    await owner.put(`/api/routes/${created.id}`).set("X-Padkos", "1").send({ visibility: "private" }).expect(200);
    await request(app).get(`/api/shared/${rotated.body.shareToken}`).expect(404);
  });

  it("only lets owners update or delete", async () => {
    const owner = await signUp("owner");
    const other = await signUp("other");
    const { trip, plan } = sampleTrip();
    const id = (await owner.post("/api/routes").set("X-Padkos", "1").send({ trip, plan, visibility: "public" })).body.route.id;
    await other.put(`/api/routes/${id}`).set("X-Padkos", "1").send({ visibility: "private" }).expect(404);
    await other.delete(`/api/routes/${id}`).set("X-Padkos", "1").expect(404);
    const renamed = { ...trip, title: "Renamed" };
    const upd = await owner.put(`/api/routes/${id}`).set("X-Padkos", "1").send({ trip: renamed });
    expect(upd.body.route.title).toBe("Renamed");
    await owner.delete(`/api/routes/${id}`).set("X-Padkos", "1").expect(200);
    await owner.get(`/api/routes/${id}`).expect(404);
  });

  it("validates input", async () => {
    const owner = await signUp("owner");
    const { trip } = sampleTrip();
    const bad = { ...trip, stops: Array.from({ length: 101 }, (_, i) => ({ id: `x${i}`, name: "x", lat: -30, lng: 25 })) };
    const res = await owner.post("/api/routes").set("X-Padkos", "1").send({ trip: bad });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stops/);
  });

  it("saves overnight choices and rejects bad departure times", async () => {
    const owner = await signUp("owner");
    const { trip, plan } = sampleTrip();
    const withNight = { ...trip, settings: { ...trip.settings, autoOvernight: false }, stops: [{ ...trip.stops[0], overnight: true, nights: 2, departTime: "09:30" }, trip.stops[1]] };
    const ok = await owner.post("/api/routes").set("X-Padkos", "1").send({ trip: withNight, plan });
    expect(ok.status).toBe(201);
    expect(ok.body.route.trip.stops[0]).toMatchObject({ overnight: true, nights: 2, departTime: "09:30" });
    expect(ok.body.route.trip.settings.autoOvernight).toBe(false);
    const bad = { ...withNight, stops: [{ ...withNight.stops[0], departTime: "25:00" }] };
    const res = await owner.post("/api/routes").set("X-Padkos", "1").send({ trip: bad, plan });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/HH:MM/);
  });
});

describe("votes and community", () => {
  it("counts votes, prevents self-voting and ranks routes", async () => {
    const owner = await signUp("owner");
    const { trip, plan } = sampleTrip();
    const a = (await owner.post("/api/routes").set("X-Padkos", "1").send({ trip: { ...trip, title: "Route A" }, plan, visibility: "public" })).body.route;
    const b = (await owner.post("/api/routes").set("X-Padkos", "1").send({ trip: { ...trip, title: "Route B" }, plan, visibility: "public" })).body.route;

    await owner.post(`/api/routes/${a.id}/vote`).set("X-Padkos", "1").send({ value: 1 }).expect(400);
    await request(app).post(`/api/routes/${a.id}/vote`).set("X-Padkos", "1").send({ value: 1 }).expect(401);

    const voters = await Promise.all(["voter1", "voter2", "voter3"].map(signUp));
    for (const v of voters) await v.post(`/api/routes/${a.id}/vote`).set("X-Padkos", "1").send({ value: 1 }).expect(200);
    const res = await voters[0].post(`/api/routes/${a.id}/vote`).set("X-Padkos", "1").send({ value: -1 });
    expect(res.body).toMatchObject({ upvotes: 2, downvotes: 1, score: 1, myVote: -1 });
    await voters[1].post(`/api/routes/${b.id}/vote`).set("X-Padkos", "1").send({ value: 1 });
    await voters[2].post(`/api/routes/${b.id}/vote`).set("X-Padkos", "1").send({ value: 1 });
    await voters[0].post(`/api/routes/${b.id}/vote`).set("X-Padkos", "1").send({ value: 1 });

    const top = (await voters[0].get("/api/community?sort=top")).body;
    expect(top.total).toBe(2);
    expect(top.routes.map((r: { title: string }) => r.title)).toEqual(["Route B", "Route A"]);
    expect(top.routes[1].myVote).toBe(-1);
    expect(top.routes[0].startCity).toBe("Cape Town");

    const popular = (await request(app).get("/api/community?sort=popular")).body.routes;
    expect(popular[0].title).toBe("Route B");

    const search = (await request(app).get("/api/community?q=Route%20A")).body.routes;
    expect(search.map((r: { title: string }) => r.title)).toEqual(["Route A"]);
    const prov = (await request(app).get("/api/community?province=Gauteng")).body.routes;
    expect(prov).toHaveLength(2);

    // clearing a vote
    const cleared = await voters[0].post(`/api/routes/${a.id}/vote`).set("X-Padkos", "1").send({ value: 0 });
    expect(cleared.body).toMatchObject({ upvotes: 2, downvotes: 0 });
  });

  it("copies a public route as an obscured private trip", async () => {
    const owner = await signUp("owner");
    const { trip, plan } = sampleTrip();
    const pub = (await owner.post("/api/routes").set("X-Padkos", "1").send({ trip, plan, visibility: "public" })).body.route;
    const fan = await signUp("fan");
    const copy = (await fan.post(`/api/routes/${pub.id}/copy`).set("X-Padkos", "1").send({}).expect(201)).body.route;
    expect(copy.isOwner).toBe(true);
    expect(copy.visibility).toBe("private");
    expect(copy.trip.start.name).toBe("Cape Town");
    expect(copy.plan).toBeNull();
    expect(JSON.stringify(copy)).not.toContain("Secret");
  });
});

describe("planning validation", () => {
  it("rejects points outside South Africa before calling any routing service", async () => {
    const res = await request(app)
      .post("/api/plan")
      .set("X-Padkos", "1")
      .send({ start: { lat: -33.92, lng: 18.42, name: "Cape Town" }, end: { lat: -24.65, lng: 25.91, name: "Gaborone" }, stops: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Gaborone/);
  });

  it("rejects more than 100 stops", async () => {
    const stops = Array.from({ length: 101 }, () => ({ lat: -30, lng: 25 }));
    const res = await request(app).post("/api/plan").set("X-Padkos", "1").send({ start: { lat: -33.9, lng: 18.4 }, end: { lat: -26.2, lng: 28 }, stops });
    expect(res.status).toBe(400);
  });

  it("serves config", async () => {
    const res = await request(app).get("/api/config").expect(200);
    expect(res.body.maxStops).toBe(100);
  });
});
