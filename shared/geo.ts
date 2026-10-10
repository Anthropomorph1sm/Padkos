// Geometry helpers shared by the server and the browser.
// Coordinates are always [lat, lng] tuples unless a function says otherwise.

export type LatLng = [number, number];

const R = 6371008.8; // mean Earth radius in metres
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Decode a Google/OSRM encoded polyline (precision 5 by default) into [lat, lng] pairs. */
export function decodePolyline(str: string, precision = 5): LatLng[] {
  const factor = 10 ** precision;
  const out: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lng += delta;
    }
    out.push([lat / factor, lng / factor]);
  }
  return out;
}

/** Encode [lat, lng] pairs as a polyline string. */
export function encodePolyline(points: LatLng[], precision = 5): string {
  const factor = 10 ** precision;
  let out = "";
  let prevLat = 0;
  let prevLng = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const [la, ln] of points) {
    const lat = Math.round(la * factor);
    const lng = Math.round(ln * factor);
    out += enc(lat - prevLat) + enc(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

/**
 * Project to a local equirectangular plane (metres) around a reference latitude.
 * Accurate enough for the sub-100 km distances we use it for.
 */
function projector(refLat: number) {
  const kx = Math.cos(toRad(refLat)) * (Math.PI / 180) * R;
  const ky = (Math.PI / 180) * R;
  return (p: LatLng) => [p[1] * kx, p[0] * ky] as const;
}

/** Distance in metres from point p to segment a-b, plus the fractional position t along the segment. */
export function pointToSegment(p: LatLng, a: LatLng, b: LatLng): { dist: number; t: number } {
  const proj = projector(p[0]);
  const [px, py] = proj(p);
  const [ax, ay] = proj(a);
  const [bx, by] = proj(b);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { dist: Math.hypot(px - cx, py - cy), t };
}

export interface NearestOnLine {
  /** distance from point to the line in metres */
  dist: number;
  /** index of the segment start vertex */
  index: number;
  /** distance along the line (metres from the first vertex) of the closest point */
  along: number;
}

/** Cumulative distances (metres) for each vertex of a line. */
export function cumulativeDistances(line: LatLng[]): number[] {
  const out = new Array<number>(line.length);
  let acc = 0;
  for (let i = 0; i < line.length; i++) {
    if (i > 0) acc += haversine(line[i - 1], line[i]);
    out[i] = acc;
  }
  return out;
}

/** Closest approach of a point to a polyline. Pass precomputed cumulative distances for speed. */
export function nearestOnLine(p: LatLng, line: LatLng[], cum?: number[]): NearestOnLine {
  if (line.length === 0) return { dist: Infinity, index: -1, along: 0 };
  if (line.length === 1) return { dist: haversine(p, line[0]), index: 0, along: 0 };
  const c = cum ?? cumulativeDistances(line);
  let best: NearestOnLine = { dist: Infinity, index: 0, along: 0 };
  // cheap bounding pre-filter: skip segments whose endpoints are both far away in degrees
  const degPad = 0.5;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    if (
      (a[0] - p[0] > degPad && b[0] - p[0] > degPad) ||
      (p[0] - a[0] > degPad && p[0] - b[0] > degPad) ||
      (a[1] - p[1] > degPad && b[1] - p[1] > degPad) ||
      (p[1] - a[1] > degPad && p[1] - b[1] > degPad)
    ) {
      continue;
    }
    const { dist, t } = pointToSegment(p, a, b);
    if (dist < best.dist) best = { dist, index: i, along: c[i] + t * (c[i + 1] - c[i]) };
  }
  if (best.dist === Infinity) {
    // point is far from everything; fall back to nearest vertex
    for (let i = 0; i < line.length; i++) {
      const d = haversine(p, line[i]);
      if (d < best.dist) best = { dist: d, index: i, along: c[i] };
    }
  }
  return best;
}

/** Douglas–Peucker simplification with tolerance in metres. */
export function simplify(line: LatLng[], toleranceM: number): LatLng[] {
  if (line.length <= 2) return line.slice();
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, line.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = pointToSegment(line[i], line[s], line[e]).dist;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > toleranceM) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

/** Total length of a line in metres. */
export function lineLength(line: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < line.length; i++) d += haversine(line[i - 1], line[i]);
  return d;
}

/**
 * Remove the parts of a line within `radiusM` of its start and of its end.
 * Used to hide exact origins/destinations on shared routes.
 */
export function trimLineEnds(line: LatLng[], radiusM: number): LatLng[] {
  if (line.length < 2) return [];
  const start = line[0];
  const end = line[line.length - 1];
  let i = 0;
  while (i < line.length && haversine(line[i], start) < radiusM) i++;
  let j = line.length - 1;
  while (j >= 0 && haversine(line[j], end) < radiusM) j--;
  if (j <= i) return [];
  return line.slice(i, j + 1);
}

export interface BBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export function bboxOf(points: LatLng[], padDeg = 0): BBox {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const [la, ln] of points) {
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (ln < minLng) minLng = ln;
    if (ln > maxLng) maxLng = ln;
  }
  return { minLat: minLat - padDeg, minLng: minLng - padDeg, maxLat: maxLat + padDeg, maxLng: maxLng + padDeg };
}

/** Split a line into consecutive chunks whose length is at most maxLenM (chunks share endpoints). */
export function chunkLine(input: LatLng[], maxLenM: number): LatLng[][] {
  // Densify first: a long straight segment (common after simplification) would otherwise
  // become one oversized chunk, because chunks can only end on a vertex.
  const step = maxLenM / 2;
  const line: LatLng[] = [];
  for (let i = 0; i < input.length; i++) {
    if (i > 0) {
      const a = input[i - 1];
      const b = input[i];
      const n = Math.floor(haversine(a, b) / step);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        line.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    line.push(input[i]);
  }
  const chunks: LatLng[][] = [];
  let cur: LatLng[] = [];
  let acc = 0;
  for (let i = 0; i < line.length; i++) {
    if (cur.length) acc += haversine(cur[cur.length - 1], line[i]);
    cur.push(line[i]);
    if (acc >= maxLenM && i < line.length - 1) {
      chunks.push(cur);
      cur = [line[i]];
      acc = 0;
    }
  }
  if (cur.length > 1 || chunks.length === 0) chunks.push(cur);
  return chunks;
}

/** Ray-casting point-in-ring test. Ring is [lng, lat] pairs (GeoJSON order). */
export function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance in metres from a point to a GeoJSON ring boundary. */
export function distanceToRing(lat: number, lng: number, ring: number[][]): number {
  let best = Infinity;
  const p: LatLng = [lat, lng];
  for (let i = 0; i < ring.length - 1; i++) {
    const a: LatLng = [ring[i][1], ring[i][0]];
    const b: LatLng = [ring[i + 1][1], ring[i + 1][0]];
    // skip far segments cheaply
    if (Math.abs(a[0] - lat) > 1 && Math.abs(b[0] - lat) > 1) continue;
    const d = pointToSegment(p, a, b).dist;
    if (d < best) best = d;
  }
  return best;
}
