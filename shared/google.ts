import type { Place } from "./types";

/**
 * Google Maps direction URLs accept an origin, a destination and at most 9 waypoints
 * (fewer on some mobile clients). Long trips are therefore split into overlapping parts:
 * each part ends where the next one starts.
 */
export const GOOGLE_MAX_POINTS = 10; // origin + 8 waypoints + destination keeps us inside every client's limit

const coord = (p: Place) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

export function googleMapsUrl(points: Place[]): string {
  if (points.length < 2) throw new Error("Need at least two points for directions");
  const origin = points[0];
  const destination = points[points.length - 1];
  const waypoints = points.slice(1, -1);
  const params = new URLSearchParams({
    api: "1",
    origin: coord(origin),
    destination: coord(destination),
    travelmode: "driving",
  });
  if (waypoints.length) params.set("waypoints", waypoints.map(coord).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export interface GooglePart {
  /** index (in the full point list) of the first and last point of this part */
  from: number;
  to: number;
  url: string;
  label: string;
}

/** Split a full point list into Google Maps sized, overlapping parts. */
export function googleMapsParts(points: Place[], maxPoints = GOOGLE_MAX_POINTS): GooglePart[] {
  if (points.length < 2) return [];
  const parts: GooglePart[] = [];
  let from = 0;
  while (from < points.length - 1) {
    const to = Math.min(points.length - 1, from + maxPoints - 1);
    const slice = points.slice(from, to + 1);
    parts.push({
      from,
      to,
      url: googleMapsUrl(slice),
      label: `${slice[0].name} → ${slice[slice.length - 1].name}`,
    });
    from = to;
  }
  return parts;
}

/**
 * Parse a Google Maps directions link into place stubs.
 * Supports `/maps/dir/a/b/c` paths and `?api=1&origin=..&destination=..&waypoints=..` links.
 * Coordinates are returned directly; free-text entries come back with NaN coordinates and need geocoding.
 */
export function parseGoogleMapsUrl(input: string): Array<{ name: string; lat: number; lng: number }> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Not a valid URL");
  }
  if (!/google\.[a-z.]+$/.test(url.hostname) && !url.hostname.startsWith("maps.app")) {
    throw new Error("Not a Google Maps link");
  }
  if (url.hostname.startsWith("maps.app") || url.hostname === "goo.gl") {
    throw new Error("Short links can't be read — open the link and copy the full URL from the address bar");
  }
  const parseEntry = (raw: string) => {
    const text = decodeURIComponent(raw.replace(/\+/g, " ")).trim();
    const m = text.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (m) return { name: text, lat: Number(m[1]), lng: Number(m[2]) };
    return { name: text, lat: NaN, lng: NaN };
  };

  const out: Array<{ name: string; lat: number; lng: number }> = [];
  if (url.searchParams.get("api") === "1") {
    const origin = url.searchParams.get("origin");
    const dest = url.searchParams.get("destination");
    const wps = url.searchParams.get("waypoints");
    if (origin) out.push(parseEntry(origin));
    if (wps) for (const w of wps.split("|")) if (w.trim()) out.push(parseEntry(w));
    if (dest) out.push(parseEntry(dest));
    return out;
  }
  const idx = url.pathname.indexOf("/dir/");
  if (idx === -1) throw new Error("Link does not contain directions");
  const segs = url.pathname
    .slice(idx + 5)
    .split("/")
    .filter(Boolean);
  for (const seg of segs) {
    if (seg.startsWith("@") || seg.startsWith("data=") || seg === "am=t") break;
    out.push(parseEntry(seg));
  }
  return out;
}
