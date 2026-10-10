// OSRM client: distance matrices (chunked beyond the server's table limit), multi-stop routes
// (chunked beyond the waypoint limit), per-leg alternatives and human-readable instructions.
import { config } from "../config";
import { fetchJson, mapLimit, UpstreamError } from "../http";
import { decodePolyline, encodePolyline, haversine, type LatLng } from "../../shared/geo";
import type { Leg, RouteAlternative, Step } from "../../shared/types";

interface OsrmStep {
  distance: number;
  duration: number;
  geometry: string;
  name: string;
  ref?: string;
  destinations?: string;
  exits?: string;
  rotary_name?: string;
  mode: string;
  maneuver: { type: string; modifier?: string; location: [number, number]; exit?: number };
}
interface OsrmLeg {
  distance: number;
  duration: number;
  summary: string;
  steps: OsrmStep[];
}
interface OsrmRoute {
  distance: number;
  duration: number;
  legs: OsrmLeg[];
}
interface OsrmRouteResponse {
  code: string;
  message?: string;
  routes: OsrmRoute[];
}
interface OsrmTableResponse {
  code: string;
  message?: string;
  durations?: (number | null)[][];
  distances?: (number | null)[][];
}

const coordStr = (pts: LatLng[]) => pts.map(([la, ln]) => `${ln.toFixed(6)},${la.toFixed(6)}`).join(";");
const base = () => `${config.osrmUrl}`;

export interface Matrices {
  durations: (number | null)[][];
  distances: (number | null)[][];
  source: "osrm" | "straight-line";
}

/** Straight-line fallback (×1.3 road factor, 80 km/h) when the routing server is unavailable. */
export function straightLineMatrix(points: LatLng[]): Matrices {
  const distances = points.map((a) => points.map((b) => haversine(a, b) * 1.3));
  const durations = distances.map((row) => row.map((d) => d / (80 / 3.6)));
  return { durations, distances, source: "straight-line" };
}

/**
 * Full n×n duration/distance matrix. OSRM rejects requests where sources×destinations exceeds
 * max-table-size², so for large n we request blocks of source rows against all destinations.
 */
export async function matrix(points: LatLng[]): Promise<Matrices> {
  const n = points.length;
  const max = config.osrmMaxTable;
  const rowsPerChunk = Math.max(1, Math.min(n, Math.floor((max * max) / n)));
  const chunks: number[][] = [];
  for (let i = 0; i < n; i += rowsPerChunk) chunks.push(Array.from({ length: Math.min(rowsPerChunk, n - i) }, (_, k) => i + k));
  const coords = coordStr(points);
  const results = await mapLimit(chunks, 2, async (rows) => {
    const params = new URLSearchParams({ annotations: "duration,distance" });
    if (chunks.length > 1) params.set("sources", rows.join(";"));
    const url = `${base()}/table/v1/${config.osrmProfile}/${coords}?${params}`;
    const res = await fetchJson<OsrmTableResponse>(url, { timeoutMs: 45000, cacheMs: 30 * 60_000 });
    if (res.code !== "Ok" || !res.durations || !res.distances) throw new UpstreamError(res.message ?? "OSRM table failed");
    return res;
  });
  const durations: (number | null)[][] = [];
  const distances: (number | null)[][] = [];
  for (const r of results) {
    durations.push(...r.durations!);
    distances.push(...r.distances!);
  }
  return { durations, distances, source: "osrm" };
}

// ------------------------------------------------------------------ instructions

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

function roadLabel(step: OsrmStep): string {
  const name = step.name?.trim();
  const ref = step.ref?.split(";")[0]?.trim();
  if (name && ref && !name.includes(ref)) return `${name} (${ref})`;
  return name || ref || "";
}

const dirWord: Record<string, string> = {
  uturn: "make a U-turn",
  "sharp right": "turn sharp right",
  right: "turn right",
  "slight right": "bear right",
  straight: "continue straight",
  "slight left": "bear left",
  left: "turn left",
  "sharp left": "turn sharp left",
};

export function instructionFor(step: OsrmStep, isLastOfLeg: boolean, legEndName?: string): string {
  const { type, modifier, exit } = step.maneuver;
  const road = roadLabel(step);
  const onto = road ? ` onto ${road}` : "";
  const mod = modifier ? dirWord[modifier] ?? modifier : "continue";
  const towards = step.destinations ? ` towards ${step.destinations.split(":").pop()!.trim()}` : "";
  switch (type) {
    case "depart":
      return `Head out${road ? ` on ${road}` : ""}`;
    case "arrive":
      return isLastOfLeg && legEndName ? `Arrive at ${legEndName}` : "Arrive at your destination";
    case "turn":
    case "end of road":
      return `${cap(mod)}${onto}${type === "end of road" ? " at the end of the road" : ""}`;
    case "new name":
      return `Continue${onto}`;
    case "continue":
      return modifier && modifier !== "straight" ? `${cap(mod)} to stay${onto || " on the road"}` : `Continue${onto}`;
    case "merge":
      return `Merge${modifier?.includes("left") ? " left" : modifier?.includes("right") ? " right" : ""}${onto}`;
    case "on ramp":
      return `Take the ramp${onto}${towards}`;
    case "off ramp":
      return `Take the ${step.exits ? `exit ${step.exits.split(";")[0]}` : "exit"}${onto}${towards}`;
    case "fork":
      return `Keep ${modifier?.includes("left") ? "left" : modifier?.includes("right") ? "right" : "straight"} at the fork${onto}${towards}`;
    case "roundabout":
    case "rotary":
    case "roundabout turn":
      return exit ? `At the ${step.rotary_name ? `${step.rotary_name} ` : ""}traffic circle, take the ${ordinal(exit)} exit${onto}` : `Enter the traffic circle${onto}`;
    case "exit roundabout":
    case "exit rotary":
      return `Exit the traffic circle${onto}`;
    case "notification":
      return `Continue${onto}`;
    default:
      return `${cap(mod)}${onto}`;
  }
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function convertLeg(leg: OsrmLeg, endName?: string): Leg {
  const line: LatLng[] = [];
  const steps: Step[] = [];
  leg.steps.forEach((s, i) => {
    const pts = decodePolyline(s.geometry);
    if (line.length && pts.length) pts.shift();
    line.push(...pts);
    steps.push({
      instruction: instructionFor(s, i === leg.steps.length - 1, endName),
      distance: s.distance,
      duration: s.duration,
      name: s.name || undefined,
      ref: s.ref || undefined,
      location: [s.maneuver.location[1], s.maneuver.location[0]],
      type: s.maneuver.type,
      modifier: s.maneuver.modifier,
    });
  });
  // merge consecutive "continue / new name" steps on the same road to keep the list readable
  const merged: Step[] = [];
  for (const s of steps) {
    const prev = merged[merged.length - 1];
    if (prev && (s.type === "new name" || s.type === "notification") && (s.ref && s.ref === prev.ref)) {
      prev.distance += s.distance;
      prev.duration += s.duration;
      continue;
    }
    merged.push(s);
  }
  return {
    distance: leg.distance,
    duration: leg.duration,
    geometry: encodePolyline(line),
    steps: merged,
    summary: cleanSummary(leg.summary),
  };
}

/** OSRM summaries can repeat refs ("N1, N1; N12"); keep each road once, in order. */
export function cleanSummary(summary: string): string {
  const parts = summary
    .split(/[,;]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
  return [...new Set(parts)].join(", ");
}

async function routeRequest(points: LatLng[], alternatives = 0): Promise<OsrmRouteResponse> {
  const params = new URLSearchParams({
    overview: "false",
    steps: "true",
    geometries: "polyline",
    continue_straight: "default",
  });
  if (alternatives > 0) params.set("alternatives", String(alternatives));
  const url = `${base()}/route/v1/${config.osrmProfile}/${coordStr(points)}?${params}`;
  const res = await fetchJson<OsrmRouteResponse>(url, { timeoutMs: 60000, cacheMs: 30 * 60_000 });
  if (res.code !== "Ok" || !res.routes?.length) {
    throw new UpstreamError(res.code === "NoRoute" ? "No drivable route between these places" : res.message ?? "Routing failed", 422);
  }
  return res;
}

/** Route through all points in order. Long lists are split into overlapping chunks. */
export async function routeThrough(points: LatLng[], names: string[] = []): Promise<Leg[]> {
  if (points.length < 2) return [];
  const max = Math.max(2, config.osrmMaxWaypoints);
  const chunks: Array<{ from: number; pts: LatLng[] }> = [];
  for (let i = 0; i < points.length - 1; i += max - 1) {
    chunks.push({ from: i, pts: points.slice(i, Math.min(points.length, i + max)) });
  }
  const results = await mapLimit(chunks, 2, (c) => routeRequest(c.pts));
  const legs: Leg[] = [];
  results.forEach((r, ci) => {
    r.routes[0].legs.forEach((leg, li) => legs.push(convertLeg(leg, names[chunks[ci].from + li + 1])));
  });
  return legs;
}

/** Up to three alternative routes between two points (OSRM only supports alternatives for 2 waypoints). */
export async function alternativesBetween(a: LatLng, b: LatLng, endName?: string): Promise<RouteAlternative[]> {
  const res = await routeRequest([a, b], 3);
  return res.routes.map((r) => {
    const leg = convertLeg(r.legs[0], endName);
    return { distance: r.distance, duration: r.duration, geometry: leg.geometry, steps: leg.steps, summary: leg.summary };
  });
}

/**
 * Costs from every point to `x` and from `x` to every point — used to find the best place
 * to insert a new stop into an existing trip without recomputing the whole matrix.
 */
export async function costsToAndFrom(points: LatLng[], x: LatLng): Promise<{ to: number[]; from: number[] }> {
  const all = [...points, x];
  const xi = all.length - 1;
  const max = config.osrmMaxTable;
  const run = async (sources: number[], destinations: number[]) => {
    const params = new URLSearchParams({
      annotations: "duration",
      sources: sources.join(";"),
      destinations: destinations.join(";"),
    });
    const res = await fetchJson<OsrmTableResponse>(`${base()}/table/v1/${config.osrmProfile}/${coordStr(all)}?${params}`, {
      timeoutMs: 30000,
      cacheMs: 10 * 60_000,
    });
    if (res.code !== "Ok" || !res.durations) throw new UpstreamError(res.message ?? "OSRM table failed");
    return res.durations;
  };
  const idx = points.map((_, i) => i);
  const groups: number[][] = [];
  for (let i = 0; i < idx.length; i += max * max - 1) groups.push(idx.slice(i, i + max * max - 1));
  const to: number[] = [];
  const from: number[] = [];
  for (const g of groups) {
    const toRows = await run(g, [xi]); // g -> x
    toRows.forEach((r) => to.push(r[0] ?? Infinity));
    const fromRow = await run([xi], g); // x -> g
    fromRow[0].forEach((v) => from.push(v ?? Infinity));
  }
  return { to, from };
}
