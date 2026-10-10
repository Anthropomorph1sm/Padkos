import { describe, expect, it } from "vitest";
import {
  chunkLine,
  decodePolyline,
  encodePolyline,
  haversine,
  nearestOnLine,
  simplify,
  trimLineEnds,
  lineLength,
  type LatLng,
} from "../shared/geo";
import { optimizeOrder, pathCost, bestInsertionIndex } from "../shared/optimize";
import { estimateFuel, toLitresPer100 } from "../shared/fuel";
import { googleMapsParts, googleMapsUrl, parseGoogleMapsUrl } from "../shared/google";
import { isInSouthAfrica } from "../shared/southAfrica";
import { findTolls, totalTolls } from "../shared/tolls";
import { fromCsv, fromGpx, fromJson, fromKml, importTrip, toCsv, toGpx, toJson, toKml, tripFromPoints } from "../shared/formats";
import type { Place, RoutePlan } from "../shared/types";

const CPT: LatLng = [-33.9249, 18.4241];
const JHB: LatLng = [-26.2041, 28.0473];

describe("geo", () => {
  it("computes haversine distances", () => {
    const d = haversine(CPT, JHB) / 1000;
    expect(d).toBeGreaterThan(1255);
    expect(d).toBeLessThan(1270);
  });

  it("round-trips polylines", () => {
    const pts: LatLng[] = [CPT, [-33.5, 19.1], [-32.3, 20.6], JHB];
    const back = decodePolyline(encodePolyline(pts));
    back.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(pts[i][0], 5);
      expect(p[1]).toBeCloseTo(pts[i][1], 5);
    });
    // known OSRM/Google example
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it("finds the nearest point on a line", () => {
    const line: LatLng[] = [
      [-30, 25],
      [-30, 26],
    ];
    const n = nearestOnLine([-30.01, 25.5], line);
    expect(n.dist).toBeGreaterThan(1050);
    expect(n.dist).toBeLessThan(1150);
    expect(n.along / 1000).toBeCloseTo(48.2, 0);
  });

  it("simplifies and chunks lines", () => {
    const line: LatLng[] = Array.from({ length: 101 }, (_, i) => [-30, 25 + i * 0.01] as LatLng);
    expect(simplify(line, 10)).toHaveLength(2);
    const chunks = chunkLine(line, 20000);
    expect(chunks.length).toBeGreaterThan(3);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i][0]).toEqual(chunks[i - 1][chunks[i - 1].length - 1]);
    // a single long straight segment is still split
    const straight = chunkLine([[-30, 22], [-30, 26]], 60000);
    expect(straight.length).toBeGreaterThanOrEqual(5);
    for (const c of straight) expect(lineLength(c)).toBeLessThanOrEqual(90000);
  });

  it("trims line ends for privacy", () => {
    const line: LatLng[] = Array.from({ length: 201 }, (_, i) => [-30, 25 + i * 0.005] as LatLng);
    const trimmed = trimLineEnds(line, 5000);
    expect(haversine(trimmed[0], line[0])).toBeGreaterThanOrEqual(5000);
    expect(haversine(trimmed[trimmed.length - 1], line[line.length - 1])).toBeGreaterThanOrEqual(5000);
    expect(trimLineEnds(line.slice(0, 5), 5000)).toEqual([]);
  });
});

function randomMatrix(n: number, seed: number) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pts = Array.from({ length: n }, () => [rnd() * 1000, rnd() * 1000]);
  return pts.map((a) => pts.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])));
}

function permutations(arr: number[]): number[][] {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
}

describe("optimizer", () => {
  it("is exact for small instances (open path)", () => {
    const m = randomMatrix(8, 7);
    const order = optimizeOrder(m, 0, 7);
    const best = Math.min(...permutations([1, 2, 3, 4, 5, 6]).map((p) => pathCost(m, [0, ...p, 7])));
    expect(pathCost(m, [0, ...order, 7])).toBeCloseTo(best, 6);
  });

  it("handles round trips (start === end)", () => {
    const m = randomMatrix(7, 3);
    const order = optimizeOrder(m, 0, 0);
    expect(order.sort()).toEqual([1, 2, 3, 4, 5, 6]);
    const best = Math.min(...permutations([1, 2, 3, 4, 5, 6]).map((p) => pathCost(m, [0, ...p, 0])));
    expect(pathCost(m, [0, ...optimizeOrder(m, 0, 0)])).toBeGreaterThan(0);
    expect(pathCost(m, [0, ...optimizeOrder(m, 0, 0), 0])).toBeCloseTo(best, 6);
  });

  it("returns a valid, good permutation for 100 stops quickly", () => {
    const n = 102;
    const m = randomMatrix(n, 11);
    const t0 = Date.now();
    const order = optimizeOrder(m, 0, n - 1, { timeBudgetMs: 500 });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    const naive = pathCost(m, Array.from({ length: n }, (_, i) => i));
    const opt = pathCost(m, [0, ...order, n - 1]);
    // random-order tour of 100 uniform points is ~5x longer than a good tour
    expect(opt).toBeLessThan(naive * 0.3);
  });

  it("copes with unreachable cells (null)", () => {
    const m = randomMatrix(15, 5) as (number | null)[][];
    m[3][4] = null;
    const order = optimizeOrder(m, 0, 14);
    expect(order).toHaveLength(13);
  });

  it("finds the cheapest insertion index", () => {
    // points on a line 0..4; inserting 2 into [1,3] between start 0 and end 4 should go between 1 and 3
    const xs = [0, 1, 2, 3, 4];
    const m = xs.map((a) => xs.map((b) => Math.abs(a - b)));
    expect(bestInsertionIndex(m, 0, 4, [1, 3], 2)).toBe(1);
  });
});

describe("fuel", () => {
  it("converts km/l to l/100km", () => {
    expect(toLitresPer100("kml", 12.5)).toBeCloseTo(8);
    expect(toLitresPer100("l100", 6)).toBe(6);
  });
  it("estimates trip cost and refuels", () => {
    const est = estimateFuel(1_400_000, { unit: "l100", value: 8, fuelType: "95", pricePerLitre: 22, tankLitres: 50 });
    expect(est.litres).toBeCloseTo(112);
    expect(est.cost).toBeCloseTo(2464);
    expect(est.rangeKm).toBeCloseTo(562.5);
    expect(est.refuels).toBe(2);
    const kml = estimateFuel(100_000, { unit: "kml", value: 10, fuelType: "diesel", pricePerLitre: 20 });
    expect(kml.litres).toBeCloseTo(10);
    expect(kml.cost).toBeCloseTo(200);
  });
});

const place = (name: string, lat: number, lng: number): Place => ({ id: name, name, lat, lng });

describe("google maps", () => {
  it("builds a directions url", () => {
    const url = new URL(googleMapsUrl([place("A", -33.9, 18.4), place("B", -33.0, 19.0), place("C", -26.2, 28.0)]));
    expect(url.searchParams.get("origin")).toBe("-33.900000,18.400000");
    expect(url.searchParams.get("waypoints")).toBe("-33.000000,19.000000");
    expect(url.searchParams.get("destination")).toBe("-26.200000,28.000000");
  });
  it("splits 102 points into overlapping parts of at most 10", () => {
    const pts = Array.from({ length: 102 }, (_, i) => place(`P${i}`, -30 + i * 0.01, 25));
    const parts = googleMapsParts(pts);
    expect(parts[0].from).toBe(0);
    expect(parts[parts.length - 1].to).toBe(101);
    for (const p of parts) {
      expect(p.to - p.from + 1).toBeLessThanOrEqual(10);
      const wp = new URL(p.url).searchParams.get("waypoints");
      expect((wp ? wp.split("|").length : 0) + 2).toBe(p.to - p.from + 1);
    }
    for (let i = 1; i < parts.length; i++) expect(parts[i].from).toBe(parts[i - 1].to);
  });
  it("parses google directions links", () => {
    const a = parseGoogleMapsUrl("https://www.google.com/maps/dir/-33.92,18.42/Stellenbosch/-34.1,18.9/@-33.9,18.6,10z/data=!3m1");
    expect(a).toHaveLength(3);
    expect(a[0]).toEqual({ name: "-33.92,18.42", lat: -33.92, lng: 18.42 });
    expect(a[1].name).toBe("Stellenbosch");
    expect(Number.isNaN(a[1].lat)).toBe(true);
    const b = parseGoogleMapsUrl(
      "https://www.google.com/maps/dir/?api=1&origin=-33.9,18.4&destination=Durban&waypoints=Knysna%7C-33.0,27.9",
    );
    expect(b.map((x) => x.name)).toEqual(["-33.9,18.4", "Knysna", "-33.0,27.9", "Durban"]);
    expect(() => parseGoogleMapsUrl("https://maps.app.goo.gl/abc")).toThrow(/Short links/);
  });
});

describe("south africa boundary", () => {
  it.each([
    ["Cape Town", -33.9249, 18.4241, true],
    ["Johannesburg", -26.2041, 28.0473, true],
    ["Durban beachfront", -29.858, 31.0365, true],
    ["Cape Point", -34.357, 18.497, true],
    ["Musina", -22.35, 30.04, true],
    ["Ladybrand (next to Lesotho)", -29.195, 27.457, true],
    ["Clarens", -28.517, 28.42, true],
    ["Maseru, Lesotho", -29.31, 27.48, false],
    ["Mbabane, Eswatini", -26.3167, 31.1333, false],
    ["Gaborone, Botswana", -24.6282, 25.9231, false],
    ["Windhoek, Namibia", -22.56, 17.08, false],
    ["Maputo, Mozambique", -25.9692, 32.5732, false],
    ["London", 51.5, -0.12, false],
  ])("%s → %s", (_n, lat, lng, expected) => {
    expect(isInSouthAfrica(lat as number, lng as number)).toBe(expected);
  });
});

describe("tolls", () => {
  // Synthetic line that runs straight through the Huguenot plaza booths
  const huguenot: LatLng = [-33.74268, 19.01986];
  const through: LatLng[] = [
    [huguenot[0] + 0.02, huguenot[1] - 0.02],
    huguenot,
    [huguenot[0] - 0.02, huguenot[1] + 0.02],
  ];
  it("detects a plaza the route passes through", () => {
    const hits = findTolls([encodePolyline(through)]);
    expect(hits.map((h) => h.id)).toEqual(["huguenot"]);
    expect(totalTolls(hits)).toBeGreaterThan(0);
  });
  it("ignores plazas the route only passes nearby", () => {
    const offset = through.map(([a, b]) => [a + 0.005, b + 0.005] as LatLng);
    expect(findTolls([encodePolyline(offset)])).toEqual([]);
  });
  it("counts both passes of a there-and-back route and applies overrides", () => {
    const back = [...through, ...through.slice(0, -1).reverse()];
    const hits = findTolls([encodePolyline(back)], { huguenot: 100 });
    expect(hits).toHaveLength(2);
    expect(totalTolls(hits)).toBe(200);
    expect(hits[0].overridden).toBe(true);
  });
  it("reports leg indices", () => {
    const hits = findTolls([encodePolyline([[-30, 25], [-30.1, 25]]), encodePolyline(through)]);
    expect(hits).toHaveLength(1);
    expect(hits[0].leg).toBe(1);
  });
});

describe("formats", () => {
  const pts = [
    place("Cape Town & Co <CBD>", -33.9249, 18.4241),
    place("Hermanus", -34.4187, 19.2345),
    place("Knysna", -34.0363, 23.0471),
  ];
  const trip = tripFromPoints(pts, "Garden \"Route\"");
  trip.stops[0].stayMinutes = 90;
  const plan: RoutePlan = {
    order: [0],
    legs: [
      { distance: 1, duration: 1, geometry: encodePolyline([pts[0].lat, pts[1].lat].map((_, i) => [pts[i].lat, pts[i].lng] as LatLng)), steps: [], summary: "" },
      { distance: 1, duration: 1, geometry: encodePolyline([[pts[1].lat, pts[1].lng], [pts[2].lat, pts[2].lng]]), steps: [], summary: "" },
    ],
    distance: 2,
    duration: 2,
    optimized: false,
    computedAt: new Date().toISOString(),
  };

  it("builds trips from points", () => {
    expect(trip.start?.name).toBe("Cape Town & Co <CBD>");
    expect(trip.stops).toHaveLength(1);
    expect(trip.end?.name).toBe("Knysna");
    const round = tripFromPoints([...pts, pts[0]]);
    expect(round.settings.roundTrip).toBe(true);
    expect(round.stops).toHaveLength(2);
  });

  it("round-trips GPX", () => {
    const gpx = toGpx(trip, plan);
    expect(gpx).toContain("<trkpt");
    const back = fromGpx(gpx).trip;
    expect(back.title).toBe('Garden "Route"');
    expect(back.start?.name).toBe("Cape Town & Co <CBD>");
    expect(back.stops[0].name).toBe("Hermanus");
    expect(back.end?.lat).toBeCloseTo(-34.0363, 5);
  });

  it("round-trips KML", () => {
    const back = fromKml(toKml(trip, plan)).trip;
    expect(back.start?.name).toBe("Cape Town & Co <CBD>");
    expect(back.end?.lng).toBeCloseTo(23.0471, 5);
  });

  it("round-trips CSV including quoting and stay times", () => {
    const back = fromCsv(toCsv(trip)).trip;
    expect(back.start?.name).toBe("Cape Town & Co <CBD>");
    expect(back.stops[0].stayMinutes).toBe(90);
  });

  it("round-trips JSON with the plan", () => {
    const res = fromJson(toJson(trip, plan));
    expect(res.trip.stops[0].name).toBe("Hermanus");
    expect(res.plan?.legs).toHaveLength(2);
  });

  it("imports a track-only GPX by sampling", () => {
    const trk = `<?xml version="1.0"?><gpx><trk><name>Drive</name><trkseg>${Array.from(
      { length: 50 },
      (_, i) => `<trkpt lat="${-33 - i * 0.01}" lon="${18.5 + i * 0.01}"></trkpt>`,
    ).join("")}</trkseg></trk></gpx>`;
    const res = importTrip("drive.gpx", trk);
    expect(res.warnings.length).toBe(1);
    expect(res.trip.stops.length).toBe(10);
  });

  it("rejects garbage", () => {
    expect(() => importTrip("x.csv", "foo,bar\n1,2")).toThrow();
    expect(() => importTrip("x.json", "{nope")).toThrow();
  });
});

import { cleanSummary, instructionFor } from "../server/services/osrm";
describe("osrm helpers", () => {
  it("cleans summaries", () => {
    expect(cleanSummary("N1, N1; N12")).toBe("N1, N12");
    expect(cleanSummary("")).toBe("");
  });
  it("writes readable instructions", () => {
    const base = { distance: 1, duration: 1, geometry: "", mode: "driving" };
    expect(instructionFor({ ...base, name: "Long Street", maneuver: { type: "turn", modifier: "left", location: [0, 0] } }, false)).toBe("Turn left onto Long Street");
    expect(instructionFor({ ...base, name: "", ref: "N2", maneuver: { type: "roundabout", exit: 2, location: [0, 0] } }, false)).toBe("At the traffic circle, take the 2nd exit onto N2");
    expect(instructionFor({ ...base, name: "", maneuver: { type: "arrive", location: [0, 0] } }, true, "Knysna")).toBe("Arrive at Knysna");
  });
});

import { distinguishingTowns } from "../shared/towns";
describe("alternative labels", () => {
  it("names the town that sets each route apart", () => {
    const viaBloem = encodePolyline([[-33.925, 18.424], [-29.116, 26.214], [-26.204, 28.047]]);
    const viaKimberley = encodePolyline([[-33.925, 18.424], [-28.738, 24.763], [-26.204, 28.047]]);
    expect(distinguishingTowns([viaBloem, viaKimberley])).toEqual(["Bloemfontein", "Kimberley"]);
    expect(distinguishingTowns([viaBloem, viaBloem])).toEqual([undefined, undefined]);
    expect(distinguishingTowns([viaBloem])).toEqual([undefined]);
  });
});
