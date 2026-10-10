import { optimizeOrder, bestInsertionIndex } from "../../shared/optimize";
import { isInSouthAfrica } from "../../shared/southAfrica";
import type { LatLng } from "../../shared/geo";
import type { OptimizeBy, RoutePlan } from "../../shared/types";
import { UpstreamError } from "../http";
import { costsToAndFrom, matrix, routeThrough, straightLineMatrix } from "./osrm";

export const MAX_STOPS = 100;

export interface PlanPoint {
  lat: number;
  lng: number;
  name?: string;
}

export interface PlanInput {
  start: PlanPoint;
  end?: PlanPoint | null;
  stops: PlanPoint[];
  optimize: boolean;
  optimizeBy?: OptimizeBy;
  roundTrip?: boolean;
}

export class ValidationError extends Error {
  status = 400;
}

export function assertInSouthAfrica(points: PlanPoint[]) {
  const bad = points.filter((p) => !isInSouthAfrica(p.lat, p.lng));
  if (bad.length) {
    throw new ValidationError(
      `Padkos only plans trips inside South Africa. Outside the border: ${bad
        .slice(0, 3)
        .map((p) => p.name ?? `${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}`)
        .join(", ")}${bad.length > 3 ? ` and ${bad.length - 3} more` : ""}`,
    );
  }
}

export async function plan(input: PlanInput): Promise<RoutePlan> {
  const { start, stops } = input;
  const roundTrip = !!input.roundTrip;
  const end = roundTrip ? start : input.end;
  if (!end) throw new ValidationError("A destination is required (or choose a round trip)");
  if (stops.length > MAX_STOPS) throw new ValidationError(`At most ${MAX_STOPS} stops are supported`);
  assertInSouthAfrica([start, end, ...stops]);

  let order = stops.map((_, i) => i);
  let matrixSource: RoutePlan["matrixSource"];
  if (input.optimize && stops.length >= 2) {
    // matrix indices: 0 = start, 1..k = stops, k+1 = end (omitted for round trips, end === start)
    const pts: LatLng[] = [[start.lat, start.lng], ...stops.map((s) => [s.lat, s.lng] as LatLng)];
    if (!roundTrip) pts.push([end.lat, end.lng]);
    let m;
    try {
      m = await matrix(pts);
    } catch (e) {
      if (e instanceof UpstreamError && e.status === 400) throw e;
      m = straightLineMatrix(pts);
    }
    matrixSource = m.source;
    const cost = input.optimizeBy === "distance" ? m.distances : m.durations;
    const endIdx = roundTrip ? 0 : pts.length - 1;
    order = optimizeOrder(cost, 0, endIdx, { timeBudgetMs: stops.length > 40 ? 700 : 350 }).map((i) => i - 1);
  }

  const ordered = [start, ...order.map((i) => stops[i]), end];
  const legs = await routeThrough(
    ordered.map((p) => [p.lat, p.lng] as LatLng),
    ordered.map((p) => p.name ?? ""),
  );
  return {
    order,
    legs,
    distance: legs.reduce((s, l) => s + l.distance, 0),
    duration: legs.reduce((s, l) => s + l.duration, 0),
    optimized: input.optimize && stops.length >= 2,
    matrixSource,
    computedAt: new Date().toISOString(),
  };
}

/** Where in the visiting order a new stop adds the least driving time. Returns an index into `stops`. */
export async function insertionIndex(
  start: PlanPoint,
  end: PlanPoint,
  stops: PlanPoint[],
  x: PlanPoint,
  legDurations?: number[],
): Promise<number> {
  assertInSouthAfrica([x]);
  const pts: LatLng[] = [[start.lat, start.lng], ...stops.map((s) => [s.lat, s.lng] as LatLng), [end.lat, end.lng]];
  const n = pts.length;
  let to: number[];
  let from: number[];
  try {
    ({ to, from } = await costsToAndFrom(pts, [x.lat, x.lng]));
  } catch {
    const sl = straightLineMatrix([...pts, [x.lat, x.lng]]);
    to = pts.map((_, i) => sl.durations[i][n] as number);
    from = pts.map((_, i) => sl.durations[n][i] as number);
  }
  // Sparse matrix: only consecutive path edges and edges to/from x are needed.
  const m: number[][] = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
  const fallback = legDurations?.length === n - 1 ? null : straightLineMatrix(pts);
  for (let i = 0; i < n; i++) {
    m[i][n] = to[i];
    m[n][i] = from[i];
    if (i < n - 1) m[i][i + 1] = fallback ? (fallback.durations[i][i + 1] as number) : legDurations![i];
  }
  return bestInsertionIndex(m, 0, n - 1, stops.map((_, i) => i + 1), n);
}
