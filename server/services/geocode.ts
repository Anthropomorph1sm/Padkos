// Geocoding restricted to South Africa: Photon (autocomplete) with a Nominatim fallback,
// and Nominatim reverse geocoding for addresses and city-level obscuring.
import { config } from "../config";
import { fetchJson } from "../http";
import { isInSouthAfrica, ZA_BOUNDS, ZA_VIEWBOX } from "../../shared/southAfrica";
import type { PlaceKind } from "../../shared/types";

export interface GeoResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
  kind: PlaceKind;
  city?: string;
  province?: string;
  type?: string;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    town?: string;
    village?: string;
    district?: string;
    locality?: string;
    county?: string;
    state?: string;
    postcode?: string;
    countrycode?: string;
    osm_key?: string;
    osm_value?: string;
    type?: string;
  };
}

const PLACE_VALUES = new Set(["city", "town", "village", "hamlet", "suburb", "neighbourhood", "locality", "municipality"]);

function photonToResult(f: PhotonFeature): GeoResult | null {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  if ((p.countrycode ?? "").toUpperCase() !== "ZA" || !isInSouthAfrica(lat, lng)) return null;
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const city = p.city ?? p.town ?? p.village ?? p.locality ?? p.district;
  const name = p.name ?? (street || city || "Unnamed place");
  const parts = [p.name && street ? street : undefined, p.district !== name ? p.district : undefined, city !== name ? city : undefined, p.state]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
  const isCity = p.osm_key === "place" && PLACE_VALUES.has(p.osm_value ?? "");
  const kind: PlaceKind = isCity
    ? "city"
    : p.osm_key === "highway" || p.osm_key === "building" || p.osm_key === "place" || street
      ? "address"
      : "poi";
  return { name, address: parts.join(", "), lat, lng, kind, city: isCity ? name : city, province: p.state, type: p.osm_value };
}

interface NominatimResult {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  category?: string;
  type?: string;
  addresstype?: string;
  address?: Record<string, string>;
}

const cityOf = (a: Record<string, string> = {}) =>
  a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb ?? a.municipality ?? a.county;

function nominatimToResult(r: NominatimResult): GeoResult | null {
  const lat = Number(r.lat);
  const lng = Number(r.lon);
  if ((r.address?.country_code ?? "za") !== "za" || !isInSouthAfrica(lat, lng)) return null;
  const name = r.name || r.display_name.split(",")[0];
  const isCity = r.category === "place" || r.category === "boundary";
  return {
    name,
    address: r.display_name.split(",").slice(1, 4).map((s) => s.trim()).join(", "),
    lat,
    lng,
    kind: isCity ? "city" : r.category === "tourism" ? "poi" : "address",
    city: isCity ? name : cityOf(r.address),
    province: r.address?.state,
    type: r.type,
  };
}

const COORD_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

export async function search(q: string, near?: { lat: number; lng: number }): Promise<GeoResult[]> {
  const query = q.trim();
  if (!query) return [];
  const m = query.match(COORD_RE);
  if (m) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (!isInSouthAfrica(lat, lng)) return [];
    return [{ name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, address: "Coordinates", lat, lng, kind: "custom" }];
  }
  try {
    const params = new URLSearchParams({
      q: query,
      limit: "10",
      lang: "en",
      bbox: `${ZA_BOUNDS.minLng},${ZA_BOUNDS.minLat},${ZA_BOUNDS.maxLng},${ZA_BOUNDS.maxLat}`,
    });
    if (near) {
      params.set("lat", String(near.lat));
      params.set("lon", String(near.lng));
    }
    const res = await fetchJson<{ features: PhotonFeature[] }>(`${config.photonUrl}/api/?${params}`, {
      timeoutMs: 8000,
      cacheMs: 24 * 3600_000,
      retries: 0,
    });
    const out = dedupe(res.features.map(photonToResult).filter((r): r is GeoResult => !!r));
    if (out.length) return out.slice(0, 8);
  } catch {
    // fall through to Nominatim
  }
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    countrycodes: "za",
    addressdetails: "1",
    limit: "8",
    viewbox: ZA_VIEWBOX,
    bounded: "1",
  });
  const res = await fetchJson<NominatimResult[]>(`${config.nominatimUrl}/search?${params}`, { cacheMs: 24 * 3600_000 });
  return dedupe(res.map(nominatimToResult).filter((r): r is GeoResult => !!r));
}

function dedupe(rs: GeoResult[]): GeoResult[] {
  const seen = new Set<string>();
  return rs.filter((r) => {
    const k = `${r.name}|${r.lat.toFixed(3)}|${r.lng.toFixed(3)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function reverse(lat: number, lng: number): Promise<GeoResult | null> {
  if (!isInSouthAfrica(lat, lng)) return null;
  const params = new URLSearchParams({
    lat: lat.toFixed(6),
    lon: lng.toFixed(6),
    format: "jsonv2",
    zoom: "18",
    addressdetails: "1",
  });
  const r = await fetchJson<NominatimResult & { error?: string }>(`${config.nominatimUrl}/reverse?${params}`, {
    cacheMs: 7 * 24 * 3600_000,
  });
  if (r.error) return null;
  const res = nominatimToResult(r);
  if (!res) return null;
  // reverse results are best labelled by street + town
  const a = r.address ?? {};
  const street = [a.house_number, a.road].filter(Boolean).join(" ");
  res.name = r.name || street || cityOf(a) || res.name;
  res.address = [street && street !== res.name ? street : undefined, a.suburb, cityOf(a), a.state]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(", ");
  return res;
}

export interface CityResult {
  name: string;
  lat: number;
  lng: number;
  province?: string;
}

/**
 * The town/city a coordinate belongs to, with the town's own centre point.
 * Used to obscure exact start and end addresses on shared routes.
 */
export async function cityFor(lat: number, lng: number): Promise<CityResult> {
  try {
    const params = new URLSearchParams({ lat: lat.toFixed(5), lon: lng.toFixed(5), format: "jsonv2", zoom: "10", addressdetails: "1" });
    const r = await fetchJson<NominatimResult & { error?: string }>(`${config.nominatimUrl}/reverse?${params}`, {
      cacheMs: 30 * 24 * 3600_000,
    });
    if (!r.error) {
      const name = cityOf(r.address) ?? r.name ?? r.display_name.split(",")[0];
      return { name, lat: Number(r.lat), lng: Number(r.lon), province: r.address?.state };
    }
  } catch {
    // fall through
  }
  // Fallback: snap to a ~10 km grid so the exact spot is still hidden.
  return { name: "Undisclosed location", lat: Math.round(lat * 10) / 10, lng: Math.round(lng * 10) / 10 };
}
