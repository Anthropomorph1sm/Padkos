import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import { encodePolyline, type LatLng } from "../shared/geo";

// Overpass is mocked: the first section's query always fails, others return one museum near the route.
const failingBoxes = new Set<string>();
const slowBoxes = new Set<string>(); // these "time out" until split
let calls: string[] = [];
vi.mock("../server/services/overpass", async (orig) => {
  const real = await orig<typeof import("../server/services/overpass")>();
  return {
    ...real,
    overpass: vi.fn(async (query: string) => {
      calls.push(query);
      if ([...failingBoxes].some((b) => query.includes(b))) throw new Error("Overpass: rate_limited");
      if ([...slowBoxes].some((b) => query.includes(b))) throw new Error('Overpass: runtime error: Query timed out in "query" at line 1 after 50 seconds.');
      // put a museum at the first box's south-west corner + a little, which is near the line
      const m = query.match(/\((-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)\)/)!;
      const lat = (Number(m[1]) + Number(m[3])) / 2;
      const lng = (Number(m[2]) + Number(m[4])) / 2;
      return [{ type: "node", id: Math.round(Math.abs(lng) * 1000), lat, lon: lng, tags: { tourism: "museum", name: `Museum at ${lng.toFixed(2)}` } }];
    }),
  };
});

process.env.ATTRACTION_RETRY_PAUSE_MS = "0";
const { createApp } = await import("../server/app");
const { openDb } = await import("../server/db");
const { planAttractionSearch } = await import("../server/services/attractions");

// a straight 400 km line west→east along latitude -30
const line: LatLng[] = Array.from({ length: 401 }, (_, i) => [-30, 22 + i * 0.01037] as LatLng);
const legs = [encodePolyline(line)];

function parse(text: string) {
  return text
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

describe("streaming attraction search", () => {
  beforeEach(() => {
    calls = [];
    failingBoxes.clear();
    slowBoxes.clear();
  });

  it("splits a section that times out and still returns its places", async () => {
    const plan = planAttractionSearch({ legs, radiusKm: 10, categories: ["museum"] });
    slowBoxes.add(plan.sections[0][0]);
    const result = await plan.run(0);
    // one museum from each half
    expect(result).toHaveLength(2);
    // the oversized query was tried once, not retried, then its two halves were fetched
    expect(calls.filter((q) => q.includes(plan.sections[0][0]))).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it("splits boxes across their longer side and shortens sections for wide radii", async () => {
    const { splitBox } = await import("../server/services/overpass");
    const { sectionLengthM } = await import("../server/services/attractions");
    expect(splitBox("-31.0000,22.0000,-30.0000,26.0000")).toEqual(["-31.0000,22.0000,-30.0000,24.0000", "-31.0000,24.0000,-30.0000,26.0000"]);
    expect(splitBox("-34.0000,22.0000,-30.0000,23.0000")).toEqual(["-34.0000,22.0000,-32.0000,23.0000", "-32.0000,22.0000,-30.0000,23.0000"]);
    expect(sectionLengthM(5)).toBeGreaterThan(sectionLengthM(25));
    expect(sectionLengthM(50)).toBe(30_000);
  });

  it("streams sections, reports failures, and retries just the failed ones", async () => {
    const plan = planAttractionSearch({ legs, radiusKm: 10, categories: ["museum"] });
    expect(plan.sections.length).toBeGreaterThanOrEqual(2);
    failingBoxes.add(plan.sections[0][0]);

    const app = createApp({ db: openDb(":memory:") });
    const res = await request(app)
      .post("/api/attractions/stream")
      .set("X-Padkos", "1")
      .send({ legs, radiusKm: 10, categories: ["museum"] })
      .buffer(true)
      .parse((r, cb) => {
        let data = "";
        r.on("data", (c: Buffer) => (data += c.toString()));
        r.on("end", () => cb(null, data));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/ndjson/);
    const events = parse(res.body as string);
    expect(events[0]).toMatchObject({ type: "start", total: plan.sections.length });
    const sections = events.filter((e) => e.type === "section");
    expect(sections).toHaveLength(plan.sections.length - 1);
    expect(sections.every((e) => e.attractions.length === 1 && e.attractions[0].category === "museum")).toBe(true);
    // failed once, automatically retried at the end, failed again, reported
    expect(events.filter((e) => e.type === "section-error").map((e) => e.index)).toEqual([0, 0]);
    expect(events.find((e) => e.type === "retrying")).toEqual({ type: "retrying", sections: [0] });
    expect(events.at(-1)).toEqual({ type: "done", failed: [0] });
    // 3 attempts in the first pass, 2 in the automatic second pass
    expect(calls.filter((q) => q.includes(plan.sections[0][0]))).toHaveLength(5);

    // the service recovers: retry only section 0
    failingBoxes.clear();
    calls = [];
    const retry = await request(app)
      .post("/api/attractions/stream")
      .set("X-Padkos", "1")
      .send({ legs, radiusKm: 10, categories: ["museum"], sections: [0] })
      .buffer(true)
      .parse((r, cb) => {
        let data = "";
        r.on("data", (c: Buffer) => (data += c.toString()));
        r.on("end", () => cb(null, data));
      });
    const retryEvents = parse(retry.body as string);
    expect(retryEvents[0]).toMatchObject({ type: "start", sections: [0] });
    expect(retryEvents.filter((e) => e.type === "section").map((e) => e.index)).toEqual([0]);
    expect(retryEvents.at(-1)).toEqual({ type: "done", failed: [] });
    expect(calls).toHaveLength(1);
  });

  it("recovers a briefly busy stretch in the automatic second pass", async () => {
    const plan = planAttractionSearch({ legs, radiusKm: 10, categories: ["museum"] });
    failingBoxes.add(plan.sections[0][0]);
    const overpassMod = await import("../server/services/overpass");
    const mock = vi.mocked(overpassMod.overpass);
    // the mirror recovers once the first pass has given up on the stretch
    let tries = 0;
    const original = mock.getMockImplementation()!;
    mock.mockImplementation(async (q: string, ...rest) => {
      if (q.includes(plan.sections[0][0]) && ++tries > 3) failingBoxes.clear();
      return original(q, ...rest);
    });
    const app = createApp({ db: openDb(":memory:") });
    const res = await request(app)
      .post("/api/attractions/stream")
      .set("X-Padkos", "1")
      .send({ legs, radiusKm: 10, categories: ["museum"] })
      .buffer(true)
      .parse((r, cb) => {
        let data = "";
        r.on("data", (c: Buffer) => (data += c.toString()));
        r.on("end", () => cb(null, data));
      });
    mock.mockImplementation(original);
    const events = parse(res.body as string);
    expect(events.filter((e) => e.type === "section" && e.index === 0)).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: "done", failed: [] });
  });

  it("validates the request before streaming", async () => {
    const app = createApp({ db: openDb(":memory:") });
    const res = await request(app).post("/api/attractions/stream").set("X-Padkos", "1").send({ legs: [], radiusKm: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});
