// Road works, closures and incidents along a route.
//  * OpenStreetMap: roads mapped as under construction or with construction notes (always available).
//  * TomTom Traffic Incidents v5: live road works / closures / accidents (when TOMTOM_API_KEY is set).
import { config } from "../config";
import { fetchJson, mapLimit } from "../http";
import { chunkLine, cumulativeDistances, decodePolyline, nearestOnLine, simplify, type LatLng } from "../../shared/geo";
import type { RoadIssue } from "../../shared/types";
import { corridorBoxes, elementLatLng, queryCorridor } from "./overpass";

const NEAR_ROUTE_M = 120;

function joinLegs(legs: string[]): LatLng[] {
  const line: LatLng[] = [];
  for (const enc of legs) {
    const pts = decodePolyline(enc);
    if (line.length && pts.length) pts.shift();
    line.push(...pts);
  }
  return line;
}

async function osmIssues(line: LatLng[]): Promise<{ issues: RoadIssue[]; failed: number }> {
  const boxes = corridorBoxes(line, 500, 50_000);
  const statements = (b: string) =>
    `way["highway"="construction"](${b});way["highway"]["construction"](${b});way["highway"]["construction:date"](${b});way["highway"]["access"="no"]["note"~"construction|closed|roadworks",i](${b});node["highway"="construction"](${b});`;
  const { elements: els, failed } = await queryCorridor(boxes, statements, { boxesPerQuery: 10 });
  const fine = simplify(line, 20);
  const cum = cumulativeDistances(fine);
  const out: RoadIssue[] = [];
  for (const e of els) {
    const pos = elementLatLng(e);
    const t = e.tags ?? {};
    if (!pos) continue;
    const near = nearestOnLine(pos, fine, cum);
    if (near.dist > NEAR_ROUTE_M + 400) continue; // way centres can sit a little off the line
    const road = t.ref ?? t.name ?? t["construction:ref"] ?? t["construction:name"];
    const isClosure = t.highway === "construction" || t.access === "no";
    out.push({
      id: `osm-${e.type}/${e.id}`,
      source: "osm",
      kind: isClosure ? "construction" : "roadworks",
      title: `${isClosure ? "Road under construction" : "Road works"}${road ? ` – ${road}` : ""}`,
      description: [t.note, t.description, t["construction:date"] ? `Expected completion: ${t["construction:date"]}` : undefined, t.opening_date ? `Opening: ${t.opening_date}` : undefined]
        .filter(Boolean)
        .join(" ∙ ") || undefined,
      lat: pos[0],
      lng: pos[1],
      distanceFromRoute: Math.round(near.dist),
      along: Math.round(near.along),
      endTime: t["construction:date"] ?? t.opening_date,
    });
  }
  return { issues: out, failed };
}

interface TomTomIncident {
  type: string;
  geometry: { type: "Point" | "LineString"; coordinates: number[] | number[][] };
  properties: {
    id?: string;
    iconCategory: number;
    magnitudeOfDelay?: number;
    events?: Array<{ description: string; code: number }>;
    startTime?: string;
    endTime?: string;
    from?: string;
    to?: string;
    delay?: number;
    roadNumbers?: string[];
  };
}

/** TomTom icon categories: https://developer.tomtom.com/traffic-api/documentation/traffic-incidents/incident-details */
const TT_KIND: Record<number, RoadIssue["kind"]> = { 7: "closure", 8: "closure", 9: "roadworks" };

async function tomtomIssues(line: LatLng[]): Promise<RoadIssue[]> {
  if (!config.tomtomKey) return [];
  // TomTom limits a bbox to 10 000 km²; 60 km chunks padded by 1 km stay well under that.
  const chunks = chunkLine(simplify(line, 100), 60_000);
  const fine = simplify(line, 20);
  const cum = cumulativeDistances(fine);
  const fields =
    "{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,delay,roadNumbers}}}";
  const lists = await mapLimit(chunks, 3, async (c) => {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const [la, ln] of c) {
      minLat = Math.min(minLat, la);
      maxLat = Math.max(maxLat, la);
      minLng = Math.min(minLng, ln);
      maxLng = Math.max(maxLng, ln);
    }
    const pad = 0.01;
    const params = new URLSearchParams({
      key: config.tomtomKey,
      bbox: [minLng - pad, minLat - pad, maxLng + pad, maxLat + pad].map((v) => v.toFixed(5)).join(","),
      fields,
      language: "en-GB",
      timeValidityFilter: "present",
    });
    try {
      const res = await fetchJson<{ incidents: TomTomIncident[] }>(
        `https://api.tomtom.com/traffic/services/5/incidentDetails?${params}`,
        { timeoutMs: 15000, cacheMs: 5 * 60_000, retries: 0 },
      );
      return res.incidents ?? [];
    } catch {
      return [];
    }
  });
  const out: RoadIssue[] = [];
  const seen = new Set<string>();
  for (const inc of lists.flat()) {
    const p = inc.properties;
    const id = p.id ?? JSON.stringify(inc.geometry.coordinates).slice(0, 60);
    if (seen.has(id)) continue;
    seen.add(id);
    const coords: number[][] = inc.geometry.type === "Point" ? [inc.geometry.coordinates as number[]] : (inc.geometry.coordinates as number[][]);
    // closest vertex of the incident to the route
    let best = { dist: Infinity, along: 0, pos: [0, 0] as LatLng };
    for (const [lng, lat] of coords) {
      const n = nearestOnLine([lat, lng], fine, cum);
      if (n.dist < best.dist) best = { dist: n.dist, along: n.along, pos: [lat, lng] };
    }
    if (best.dist > NEAR_ROUTE_M) continue;
    const desc = p.events?.map((e) => e.description).join("; ");
    out.push({
      id: `tt-${id}`,
      source: "tomtom",
      kind: TT_KIND[p.iconCategory] ?? "incident",
      // name the road: its number when TomTom has one, otherwise the street the incident starts on
      title: `${desc ?? "Traffic incident"} – ${p.roadNumbers?.length ? p.roadNumbers.join("/") : (p.from?.split(" / ")[0] ?? "on your route")}`,
      description: p.from && p.to ? `${p.from} → ${p.to}` : p.from,
      lat: best.pos[0],
      lng: best.pos[1],
      distanceFromRoute: Math.round(best.dist),
      along: Math.round(best.along),
      delaySeconds: p.delay,
      startTime: p.startTime,
      endTime: p.endTime,
    });
  }
  return out;
}

export interface RoadworksResult {
  issues: RoadIssue[];
  sources: { osm: boolean; tomtom: boolean };
  errors: string[];
}

export async function roadIssues(legs: string[]): Promise<RoadworksResult> {
  const line = joinLegs(legs);
  if (line.length < 2) return { issues: [], sources: { osm: false, tomtom: false }, errors: [] };
  const errors: string[] = [];
  const [osmRes, tt] = await Promise.all([
    osmIssues(line).catch((e) => {
      errors.push(`OpenStreetMap: ${(e as Error).message}`);
      return { issues: [] as RoadIssue[], failed: 0 };
    }),
    tomtomIssues(line).catch((e) => {
      errors.push(`TomTom: ${(e as Error).message}`);
      return [] as RoadIssue[];
    }),
  ]);
  if (osmRes.failed) errors.push(`OpenStreetMap: ${osmRes.failed} section(s) of the route could not be checked`);
  const osm = osmRes.issues;
  // keep one OSM issue per ~2 km stretch (a long construction way is often split into many pieces)
  const osmDeduped: RoadIssue[] = [];
  for (const i of osm.sort((a, b) => (a.along ?? 0) - (b.along ?? 0))) {
    const prev = osmDeduped[osmDeduped.length - 1];
    if (prev && Math.abs((prev.along ?? 0) - (i.along ?? 0)) < 2000 && prev.kind === i.kind) continue;
    osmDeduped.push(i);
  }
  return {
    issues: [...tt, ...osmDeduped].sort((a, b) => (a.along ?? 0) - (b.along ?? 0)),
    sources: { osm: true, tomtom: !!config.tomtomKey },
    errors,
  };
}
