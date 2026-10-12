// Accommodation near overnight stops, from OpenStreetMap. Prices and availability live on the
// booking sites; this only finds what is there.
import { mapLimit } from "../http";
import { haversine } from "../../shared/geo";
import type { StayKind, StayOption } from "../../shared/types";
import { elementLatLng, overpass, type OsmElement } from "./overpass";

const KINDS: StayKind[] = ["hotel", "motel", "guest_house", "hostel", "chalet", "apartment", "camp_site", "caravan_site", "alpine_hut", "wilderness_hut"];
const KIND_SET = new Set<string>(KINDS);

export interface StayPoint {
  id: string;
  lat: number;
  lng: number;
}

export type StayResult = { id: string; stays: StayOption[] } | { id: string; error: string };

/** Points per Overpass request: `around` a single point is cheap, so a few share one query. */
const POINTS_PER_QUERY = 4;
const PER_POINT_LIMIT = 80;

function toOption(e: OsmElement, p: StayPoint, radiusM: number): StayOption | null {
  const t = e.tags ?? {};
  const pos = elementLatLng(e);
  if (!pos || !t.name || !KIND_SET.has(t.tourism)) return null;
  const distance = Math.round(haversine([p.lat, p.lng], pos));
  if (distance > radiusM) return null;
  const stars = Number.parseFloat(t.stars);
  return {
    id: `${e.type}/${e.id}`,
    name: t.name,
    lat: pos[0],
    lng: pos[1],
    kind: t.tourism as StayKind,
    distance,
    stars: Number.isFinite(stars) && stars > 0 && stars <= 7 ? stars : undefined,
    website: t.website ?? t["contact:website"],
    phone: t.phone ?? t["contact:phone"],
    town: t["addr:city"] ?? t["addr:town"] ?? t["addr:place"] ?? t["addr:suburb"],
  };
}

export async function staysNear(points: StayPoint[], radiusKm: number): Promise<StayResult[]> {
  const radiusM = Math.round(radiusKm * 1000);
  const groups: StayPoint[][] = [];
  for (let i = 0; i < points.length; i += POINTS_PER_QUERY) groups.push(points.slice(i, i + POINTS_PER_QUERY));
  const filter = `["tourism"~"^(${KINDS.join("|")})$"]["name"]`;
  const results = await mapLimit(groups, 2, async (g): Promise<StayResult[]> => {
    const query = `[out:json][timeout:40];(${g.map((p) => `nwr${filter}(around:${radiusM},${p.lat.toFixed(5)},${p.lng.toFixed(5)});`).join("")});out center tags qt;`;
    try {
      const els = await overpass(query, 50_000);
      return g.map((p) => ({
        id: p.id,
        stays: els
          .map((e) => toOption(e, p, radiusM))
          .filter((o): o is StayOption => o !== null)
          .sort((a, b) => a.distance - b.distance)
          .slice(0, PER_POINT_LIMIT),
      }));
    } catch (e) {
      return g.map((p) => ({ id: p.id, error: (e as Error).message }));
    }
  });
  return results.flat();
}
