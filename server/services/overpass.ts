// Overpass API helper. Public Overpass mirrors are shared, rate limited and sometimes down, so:
//  * requests rotate across mirrors, and a mirror that fails is put on a short cooldown;
//  * corridor queries are split into groups and return partial results if some groups fail.
import { config } from "../config";
import { fetchJson, mapLimit, UpstreamError } from "../http";
import { bboxOf, chunkLine, simplify, type LatLng } from "../../shared/geo";

export interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const cooldownUntil = new Map<string, number>();
let rr = 0;

function mirrorsInOrder(): string[] {
  const urls = config.overpassUrls;
  const start = rr++ % urls.length;
  const rotated = [...urls.slice(start), ...urls.slice(0, start)];
  const now = Date.now();
  // healthy mirrors first, cooling-down ones as a last resort
  return [...rotated.filter((u) => (cooldownUntil.get(u) ?? 0) <= now), ...rotated.filter((u) => (cooldownUntil.get(u) ?? 0) > now)];
}

/** Run a query, trying up to `maxMirrors` mirrors (healthy ones first, rotating to spread load). */
export async function overpass(query: string, timeoutMs = 90000, maxMirrors = Infinity): Promise<OsmElement[]> {
  let lastErr: unknown;
  for (const url of mirrorsInOrder().slice(0, maxMirrors)) {
    try {
      const res = await fetchJson<{ elements: OsmElement[]; remark?: string }>(url, {
        method: "POST",
        body: new URLSearchParams({ data: query }).toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeoutMs,
        cacheMs: 6 * 3600_000,
        retries: 0,
      });
      if (res.remark && /runtime error|timed out|out of memory|rate_limited/i.test(res.remark) && !res.elements.length) {
        throw new UpstreamError(`Overpass: ${res.remark}`);
      }
      cooldownUntil.delete(url);
      return res.elements;
    } catch (e) {
      lastErr = e;
      cooldownUntil.set(url, Date.now() + 60_000);
    }
  }
  throw lastErr instanceof Error ? lastErr : new UpstreamError("Overpass unavailable");
}

/**
 * Bounding boxes covering a corridor of `radiusM` around a line, as Overpass bbox strings
 * (south,west,north,east). Boxes along the route are far cheaper for Overpass than one long
 * `around` polyline; results are filtered by true distance afterwards.
 */
export function corridorBoxes(line: LatLng[], radiusM: number, chunkM = 60000): string[] {
  const simp = simplify(line, Math.min(200, radiusM / 4));
  const latPad = radiusM / 111_000;
  return chunkLine(simp, chunkM).map((c) => {
    const midLat = c[Math.floor(c.length / 2)][0];
    const lngPad = radiusM / (111_000 * Math.cos((midLat * Math.PI) / 180));
    const b = bboxOf(c);
    return [b.minLat - latPad, b.minLng - lngPad, b.maxLat + latPad, b.maxLng + lngPad].map((v) => v.toFixed(4)).join(",");
  });
}

export interface CorridorResult {
  elements: OsmElement[];
  /** number of query groups that failed (results are partial when > 0) */
  failed: number;
  total: number;
  error?: string;
}

/** Run `statements(bbox)` for every box, grouped into a few Overpass requests; dedupes elements. */
export async function queryCorridor(
  boxes: string[],
  statements: (bbox: string) => string,
  opts: { boxesPerQuery?: number; concurrency?: number; out?: string } = {},
): Promise<CorridorResult> {
  const per = opts.boxesPerQuery ?? 8;
  const groups: string[][] = [];
  for (let i = 0; i < boxes.length; i += per) groups.push(boxes.slice(i, i + per));
  let error: string | undefined;
  const run = (g: string[]) => overpass(`[out:json][timeout:80];(${g.map(statements).join("")});${opts.out ?? "out center tags qt;"}`);
  const results: Array<OsmElement[] | null> = await mapLimit(groups, opts.concurrency ?? Math.min(2, config.overpassUrls.length), async (g) => {
    try {
      return await run(g);
    } catch (e) {
      error = (e as Error).message;
      return null;
    }
  });
  // one more pass for groups that failed — public mirrors often recover within seconds
  const retry = results.map((r, i) => (r === null ? i : -1)).filter((i) => i >= 0);
  if (retry.length) {
    await new Promise((r) => setTimeout(r, 2500));
    for (const i of retry) {
      try {
        results[i] = await run(groups[i]);
      } catch (e) {
        error = (e as Error).message;
      }
    }
  }
  const failed = results.filter((r) => r === null).length;
  if (failed === groups.length && groups.length) throw new UpstreamError(`Map data service unavailable (${error})`, 503);
  const seen = new Set<string>();
  const out: OsmElement[] = [];
  for (const els of results)
    for (const e of els ?? []) {
      const k = `${e.type}/${e.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
    }
  return { elements: out, failed, total: groups.length, error };
}

/** True for failures caused by a query being too big (worth splitting rather than repeating). */
export function isOverloadError(e: unknown): boolean {
  return /timed out|timeout|504|out of memory/i.test((e as Error)?.message ?? "");
}

/** Split an Overpass bbox string (south,west,north,east) in half across its longer side. */
export function splitBox(box: string): [string, string] {
  const [s, w, n, e] = box.split(",").map(Number);
  const fmt = (v: number[]) => v.map((x) => x.toFixed(4)).join(",");
  const midLat = (s + n) / 2;
  const midLng = (w + e) / 2;
  const tallerThanWide = n - s > (e - w) * Math.cos((midLat * Math.PI) / 180);
  return tallerThanWide ? [fmt([s, w, midLat, e]), fmt([midLat, w, n, e])] : [fmt([s, w, n, midLng]), fmt([s, midLng, n, e])];
}

export const elementLatLng = (e: OsmElement): LatLng | null => {
  if (e.lat != null && e.lon != null) return [e.lat, e.lon];
  if (e.center) return [e.center.lat, e.center.lon];
  return null;
};
