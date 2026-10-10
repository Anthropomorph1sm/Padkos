import { cumulativeDistances, decodePolyline, haversine, pointToSegment, type LatLng } from "./geo";
import { TOLL_PLAZAS, type TollPlaza } from "./tollPlazas";
import type { TollHit } from "./types";

/** How close (metres) the route must pass a booth for it to count. */
const MAINLINE_THRESHOLD_M = 70;
const RAMP_THRESHOLD_M = 35;
/** Two hits on the same plaza further apart than this along the route are separate passes. */
const SEPARATE_PASS_M = 3000;

/**
 * Find every toll plaza a route passes through.
 * `legs` are encoded polylines, one per leg; hits are reported with their leg index.
 */
export function findTolls(
  legs: string[],
  overrides: Record<string, number> = {},
  plazas: TollPlaza[] = TOLL_PLAZAS,
): TollHit[] {
  const hits: TollHit[] = [];
  let legOffset = 0;
  legs.forEach((encoded, legIndex) => {
    const line = decodePolyline(encoded);
    if (line.length < 2) return;
    const cum = cumulativeDistances(line);
    // bounding box of the leg (padded ~1 km) to skip irrelevant plazas fast
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const [la, ln] of line) {
      if (la < minLat) minLat = la;
      if (la > maxLat) maxLat = la;
      if (ln < minLng) minLng = ln;
      if (ln > maxLng) maxLng = ln;
    }
    const pad = 0.01;
    for (const plaza of plazas) {
      const threshold = plaza.ramp ? RAMP_THRESHOLD_M : MAINLINE_THRESHOLD_M;
      const near = plaza.points.filter(
        ([la, ln]) => la > minLat - pad && la < maxLat + pad && ln > minLng - pad && ln < maxLng + pad,
      );
      if (!near.length) continue;
      const passes: number[] = []; // along-distances of matches
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i];
        const b = line[i + 1];
        for (const pt of near) {
          // quick reject: both segment ends further than segment length + threshold
          const segLen = cum[i + 1] - cum[i];
          if (haversine(a, pt as LatLng) > segLen + threshold + 50) continue;
          const { dist, t } = pointToSegment(pt as LatLng, a, b);
          if (dist <= threshold) {
            passes.push(cum[i] + t * segLen);
            break;
          }
        }
      }
      if (!passes.length) continue;
      passes.sort((x, y) => x - y);
      const distinct: number[] = [passes[0]];
      for (const p of passes) if (p - distinct[distinct.length - 1] > SEPARATE_PASS_M) distinct.push(p);
      for (const along of distinct) {
        const overridden = Object.prototype.hasOwnProperty.call(overrides, plaza.id);
        hits.push({
          id: plaza.id,
          name: plaza.name,
          road: plaza.road,
          fee: overridden ? Number(overrides[plaza.id]) : plaza.fee,
          overridden,
          lat: plaza.points[0][0],
          lng: plaza.points[0][1],
          along: legOffset + along,
          leg: legIndex,
        });
      }
    }
    legOffset += cum[cum.length - 1];
  });
  return hits.sort((a, b) => a.along - b.along);
}

export function totalTolls(hits: TollHit[]): number {
  return hits.reduce((s, h) => s + (Number.isFinite(h.fee) ? h.fee : 0), 0);
}
