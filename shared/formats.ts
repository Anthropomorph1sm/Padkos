// Import / export of trips: native JSON, GPX 1.1, KML 2.2 and CSV.
import { XMLParser } from "fast-xml-parser";
import { decodePolyline, simplify, type LatLng } from "./geo";
import type { Place, RoutePlan, Trip, TripSettings } from "./types";

export const DEFAULT_SETTINGS: TripSettings = {
  optimize: true,
  optimizeBy: "duration",
  roundTrip: false,
  fuel: { unit: "l100", value: 7.5, fuelType: "95", pricePerLitre: 21.6, tankLitres: 50 },
  maxDriveHoursPerDay: 8,
  passengers: 1,
  attractionRadiusKm: 10,
};

export function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID().slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}

export function emptyTrip(): Trip {
  return {
    version: 1,
    title: "Untitled road trip",
    start: null,
    end: null,
    stops: [],
    settings: structuredClone(DEFAULT_SETTINGS),
  };
}

/** Points in visiting order: start, stops..., end (end = start for round trips). */
export function tripPoints(trip: Trip): Place[] {
  const pts: Place[] = [];
  if (trip.start) pts.push(trip.start);
  pts.push(...trip.stops);
  if (trip.settings.roundTrip) {
    if (trip.start) pts.push(trip.start);
  } else if (trip.end) pts.push(trip.end);
  return pts;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function allGeometry(plan: RoutePlan | null | undefined, maxPoints = 20000): LatLng[] {
  if (!plan) return [];
  const pts: LatLng[] = [];
  for (const leg of plan.legs) {
    const line = decodePolyline(leg.geometry);
    if (pts.length && line.length) line.shift();
    pts.push(...line);
  }
  if (pts.length <= maxPoints) return pts;
  // progressively simplify until small enough
  let tol = 5;
  let out = pts;
  while (out.length > maxPoints && tol < 2000) {
    out = simplify(pts, tol);
    tol *= 2;
  }
  return out;
}

// ---------------------------------------------------------------- export

export function toJson(trip: Trip, plan?: RoutePlan | null): string {
  return JSON.stringify({ format: "padkos-trip", version: 1, exportedAt: new Date().toISOString(), trip, plan: plan ?? null }, null, 2);
}

export function toGpx(trip: Trip, plan?: RoutePlan | null): string {
  const pts = tripPoints(trip);
  const wpt = pts
    .map(
      (p, i) =>
        `  <wpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><name>${esc(p.name)}</name>${
          p.address ? `<desc>${esc(p.address)}</desc>` : ""
        }<type>${i === 0 ? "start" : i === pts.length - 1 ? "end" : "stop"}</type></wpt>`,
    )
    .join("\n");
  const rte = pts
    .map((p) => `    <rtept lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><name>${esc(p.name)}</name></rtept>`)
    .join("\n");
  const geom = allGeometry(plan);
  const trk = geom.length
    ? `  <trk><name>${esc(trip.title)}</name><trkseg>\n${geom
        .map(([la, ln]) => `    <trkpt lat="${la.toFixed(6)}" lon="${ln.toFixed(6)}"/>`)
        .join("\n")}\n  </trkseg></trk>\n`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Padkos Road Trip Planner" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(trip.title)}</name>${trip.description ? `<desc>${esc(trip.description)}</desc>` : ""}</metadata>
${wpt}
  <rte><name>${esc(trip.title)}</name>
${rte}
  </rte>
${trk}</gpx>
`;
}

export function toKml(trip: Trip, plan?: RoutePlan | null): string {
  const pts = tripPoints(trip);
  const placemarks = pts
    .map(
      (p, i) => `    <Placemark><name>${esc(p.name)}</name>${p.address ? `<description>${esc(p.address)}</description>` : ""}<styleUrl>#${
        i === 0 ? "start" : i === pts.length - 1 ? "end" : "stop"
      }</styleUrl><Point><coordinates>${p.lng.toFixed(6)},${p.lat.toFixed(6)},0</coordinates></Point></Placemark>`,
    )
    .join("\n");
  const geom = allGeometry(plan);
  const line = geom.length
    ? `    <Placemark><name>Route</name><styleUrl>#route</styleUrl><LineString><tessellate>1</tessellate><coordinates>${geom
        .map(([la, ln]) => `${ln.toFixed(6)},${la.toFixed(6)},0`)
        .join(" ")}</coordinates></LineString></Placemark>\n`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(trip.title)}</name>
    <Style id="route"><LineStyle><color>ff2f6bd9</color><width>4</width></LineStyle></Style>
    <Style id="start"><IconStyle><color>ff3c9a2e</color></IconStyle></Style>
    <Style id="stop"><IconStyle><color>ff2f6bd9</color></IconStyle></Style>
    <Style id="end"><IconStyle><color>ff2b2bd0</color></IconStyle></Style>
${placemarks}
${line}  </Document>
</kml>
`;
}

const csvCell = (v: string | number | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(trip: Trip): string {
  const pts = tripPoints(trip);
  const rows = [["order", "role", "name", "lat", "lng", "address", "stay_minutes", "notes"].join(",")];
  pts.forEach((p, i) =>
    rows.push(
      [
        i + 1,
        i === 0 ? "start" : i === pts.length - 1 ? "end" : "stop",
        p.name,
        p.lat.toFixed(6),
        p.lng.toFixed(6),
        p.address ?? "",
        p.stayMinutes ?? "",
        p.notes ?? "",
      ]
        .map(csvCell)
        .join(","),
    ),
  );
  return rows.join("\n") + "\n";
}

// ---------------------------------------------------------------- import

export interface ImportResult {
  trip: Trip;
  plan: RoutePlan | null;
  warnings: string[];
}

function placeFrom(name: string | undefined, lat: number, lng: number, extra: Partial<Place> = {}): Place {
  return { id: newId(), name: (name ?? "").trim() || `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng, kind: "custom", ...extra };
}

/** Build a trip from an ordered list of points: first = start, last = end. */
export function tripFromPoints(points: Place[], title = "Imported trip"): Trip {
  const trip = emptyTrip();
  trip.title = title;
  if (!points.length) return trip;
  trip.start = points[0];
  if (points.length > 1) {
    const last = points[points.length - 1];
    const first = points[0];
    trip.stops = points.slice(1, -1);
    if (Math.abs(last.lat - first.lat) < 1e-5 && Math.abs(last.lng - first.lng) < 1e-5 && points.length > 2) {
      trip.settings.roundTrip = true;
      trip.end = null;
    } else trip.end = last;
  }
  return trip;
}

const asArray = <T,>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as object)) return String((v as Record<string, unknown>)["#text"]);
  return undefined;
};

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  parseTagValue: false,
  processEntities: true,
});

/** Thin out a long list of track points to at most `max` evenly-spaced points. */
function sample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (max - 1))]);
  return out;
}

export function fromGpx(content: string): ImportResult {
  const doc = xml.parse(content);
  const gpx = doc.gpx;
  if (!gpx) throw new Error("Not a GPX file");
  const warnings: string[] = [];
  const title = text(gpx.metadata?.name) ?? text(asArray(gpx.rte)[0]?.name) ?? text(asArray(gpx.trk)[0]?.name) ?? "Imported GPX";
  const toPlace = (p: Record<string, unknown>) =>
    placeFrom(text(p.name), Number(p["@lat"]), Number(p["@lon"]), { address: text(p.desc) });

  // Prefer an explicit route, then waypoints, then a thinned track.
  let points: Place[] = [];
  const rte = asArray(gpx.rte)[0] as Record<string, unknown> | undefined;
  if (rte && asArray(rte.rtept).length >= 2) {
    points = asArray(rte.rtept as Record<string, unknown>[]).map(toPlace);
  } else if (asArray(gpx.wpt).length >= 2) {
    points = asArray(gpx.wpt as Record<string, unknown>[]).map(toPlace);
  } else {
    const trkpts = asArray(gpx.trk).flatMap((t: Record<string, unknown>) =>
      asArray(t.trkseg as Record<string, unknown>[]).flatMap((s) => asArray(s.trkpt as Record<string, unknown>[])),
    );
    if (trkpts.length >= 2) {
      points = sample(trkpts, 12).map((p, i, a) =>
        placeFrom(i === 0 ? "Track start" : i === a.length - 1 ? "Track end" : `Track point ${i}`, Number(p["@lat"]), Number(p["@lon"])),
      );
      warnings.push("The file only contained a recorded track, so it was sampled into a few stops.");
    }
  }
  points = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (points.length < 2) throw new Error("No usable points found in GPX file");
  return { trip: tripFromPoints(points, title), plan: null, warnings };
}

export function fromKml(content: string): ImportResult {
  const doc = xml.parse(content);
  const root = doc.kml;
  if (!root) throw new Error("Not a KML file");
  const warnings: string[] = [];
  // Collect Placemarks anywhere in the tree (Document/Folder nesting).
  const placemarks: Record<string, unknown>[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "Placemark") placemarks.push(...asArray(v as Record<string, unknown> | Record<string, unknown>[]));
      else if (typeof v === "object") asArray(v).forEach(walk);
    }
  };
  walk(root);
  const points: Place[] = [];
  for (const pm of placemarks) {
    const pt = pm.Point as Record<string, unknown> | undefined;
    const coords = text(pt?.coordinates);
    if (!coords) continue;
    const [lng, lat] = coords.trim().split(",").map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) points.push(placeFrom(text(pm.name), lat, lng, { address: text(pm.description) }));
  }
  if (points.length < 2) {
    // Fall back to a LineString
    for (const pm of placemarks) {
      const ls = pm.LineString as Record<string, unknown> | undefined;
      const coords = text(ls?.coordinates);
      if (!coords) continue;
      const line = coords
        .trim()
        .split(/\s+/)
        .map((c) => c.split(",").map(Number))
        .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
      if (line.length >= 2) {
        sample(line, 12).forEach((c, i, a) =>
          points.push(placeFrom(i === 0 ? "Line start" : i === a.length - 1 ? "Line end" : `Line point ${i}`, c[1], c[0])),
        );
        warnings.push("The file only contained a line, so it was sampled into a few stops.");
        break;
      }
    }
  }
  if (points.length < 2) throw new Error("No usable points found in KML file");
  const title = text((root.Document as Record<string, unknown> | undefined)?.name) ?? "Imported KML";
  return { trip: tripFromPoints(points, title), plan: null, warnings };
}

/** Minimal RFC 4180 CSV parser. */
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (quoted) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && content[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function fromCsv(content: string): ImportResult {
  const rows = parseCsv(content);
  if (rows.length < 2) throw new Error("CSV needs a header row and at least two points");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iLat = col("lat", "latitude", "y");
  const iLng = col("lng", "lon", "long", "longitude", "x");
  const iName = col("name", "title", "label", "place");
  const iAddr = col("address", "description", "desc");
  const iStay = col("stay_minutes", "stay", "minutes");
  const iNotes = col("notes", "note");
  if (iLat === -1 || iLng === -1) throw new Error("CSV must have lat and lng (or latitude / longitude) columns");
  const warnings: string[] = [];
  const points: Place[] = [];
  rows.slice(1).forEach((r, n) => {
    const lat = Number(r[iLat]);
    const lng = Number(r[iLng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      warnings.push(`Row ${n + 2} skipped: invalid coordinates`);
      return;
    }
    const stay = iStay >= 0 ? Number(r[iStay]) : NaN;
    points.push(
      placeFrom(iName >= 0 ? r[iName] : undefined, lat, lng, {
        address: iAddr >= 0 && r[iAddr] ? r[iAddr] : undefined,
        stayMinutes: Number.isFinite(stay) && stay > 0 ? stay : undefined,
        notes: iNotes >= 0 && r[iNotes] ? r[iNotes] : undefined,
      }),
    );
  });
  if (points.length < 2) throw new Error("CSV needs at least two valid points");
  return { trip: tripFromPoints(points, "Imported CSV"), plan: null, warnings };
}

function isPlace(p: unknown): p is Place {
  return !!p && typeof p === "object" && Number.isFinite((p as Place).lat) && Number.isFinite((p as Place).lng);
}

export function fromJson(content: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error("Invalid JSON");
  }
  const obj = data as { format?: string; trip?: Trip; plan?: RoutePlan | null };
  const t = obj.format === "padkos-trip" ? obj.trip : (data as Trip);
  if (!t || typeof t !== "object" || !Array.isArray(t.stops)) throw new Error("JSON is not a Padkos trip export");
  const base = emptyTrip();
  const fix = (p: Place): Place => ({ ...p, id: p.id || newId(), name: String(p.name ?? "Stop") });
  const trip: Trip = {
    ...base,
    title: typeof t.title === "string" ? t.title : base.title,
    description: typeof t.description === "string" ? t.description : undefined,
    start: isPlace(t.start) ? fix(t.start) : null,
    end: isPlace(t.end) ? fix(t.end) : null,
    stops: t.stops.filter(isPlace).map(fix),
    settings: { ...base.settings, ...(t.settings ?? {}), fuel: { ...base.settings.fuel, ...(t.settings?.fuel ?? {}) } },
    tollOverrides: t.tollOverrides,
  };
  return { trip, plan: obj.plan ?? null, warnings: [] };
}

export type ImportFormat = "json" | "gpx" | "kml" | "csv";

export function detectFormat(filename: string, content: string): ImportFormat {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "gpx" || ext === "kml" || ext === "csv" || ext === "json") return ext;
  const head = content.trimStart().slice(0, 400);
  if (head.startsWith("{")) return "json";
  if (head.includes("<gpx")) return "gpx";
  if (head.includes("<kml")) return "kml";
  return "csv";
}

export function importTrip(filename: string, content: string): ImportResult {
  switch (detectFormat(filename, content)) {
    case "json":
      return fromJson(content);
    case "gpx":
      return fromGpx(content);
    case "kml":
      return fromKml(content);
    default:
      return fromCsv(content);
  }
}
