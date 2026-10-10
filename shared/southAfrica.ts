// South Africa-only enforcement.
import boundary from "./za-boundary.json";
import { distanceToRing, pointInRing } from "./geo";

type Poly = number[][][]; // [outer, ...holes], rings of [lng, lat]

const polygons: Poly[] = (boundary.geometry.type === "MultiPolygon"
  ? boundary.geometry.coordinates
  : [boundary.geometry.coordinates]) as Poly[];

/** Rough bounding box of mainland South Africa (lat/lng). */
export const ZA_BOUNDS = { minLat: -34.9, maxLat: -22.1, minLng: 16.3, maxLng: 33.0 };
/** Viewbox string for geocoders: minLng,maxLat,maxLng,minLat */
export const ZA_VIEWBOX = `${ZA_BOUNDS.minLng},${ZA_BOUNDS.maxLat},${ZA_BOUNDS.maxLng},${ZA_BOUNDS.minLat}`;
export const ZA_CENTER: [number, number] = [-29.0, 24.5];

/** Tolerance (metres) for points just outside the simplified boundary, e.g. on the coast or a border post. */
const EDGE_TOLERANCE_M = 3000;
/** Much tighter tolerance around Lesotho, whose border runs right past towns like Ladybrand and Maseru. */
const HOLE_TOLERANCE_M = 400;

/**
 * True when a coordinate lies in South Africa. Lesotho and Eswatini are excluded
 * (Lesotho is a hole in the boundary; Eswatini lies outside it).
 */
export function isInSouthAfrica(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < ZA_BOUNDS.minLat - 0.1 || lat > ZA_BOUNDS.maxLat + 0.1 || lng < ZA_BOUNDS.minLng - 0.1 || lng > ZA_BOUNDS.maxLng + 0.1) {
    // the Prince Edward Islands are part of SA but unreachable by road; ignore them
    return false;
  }
  for (const poly of polygons) {
    const [outer, ...holes] = poly;
    if (pointInRing(lat, lng, outer)) {
      const inHole = holes.some((h) => pointInRing(lat, lng, h) && distanceToRing(lat, lng, h) > HOLE_TOLERANCE_M);
      if (!inHole) return true;
    } else if (distanceToRing(lat, lng, outer) <= EDGE_TOLERANCE_M) {
      return true;
    }
  }
  return false;
}
