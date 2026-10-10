// Attractions near a route, ranked by a popularity heuristic.
import { config } from "../config";
import { fetchJson, mapLimit, UpstreamError } from "../http";
import { cumulativeDistances, decodePolyline, nearestOnLine, simplify, type LatLng } from "../../shared/geo";
import type { Attraction, AttractionCategory } from "../../shared/types";
import { corridorBoxes, elementLatLng, isOverloadError, overpass, splitBox, type OsmElement } from "./overpass";

export const ALL_CATEGORIES: AttractionCategory[] = [
  "attraction",
  "nature",
  "viewpoint",
  "museum",
  "heritage",
  "wine",
  "beach",
  "camping",
  "food",
  "fuel",
];

const TOURISM: Partial<Record<AttractionCategory, string[]>> = {
  attraction: ["attraction", "theme_park", "zoo", "aquarium"],
  viewpoint: ["viewpoint"],
  museum: ["museum", "gallery"],
  wine: ["wine_cellar"],
  camping: ["camp_site", "caravan_site"],
};
const NATURAL: Partial<Record<AttractionCategory, string[]>> = {
  nature: ["waterfall", "cave_entrance", "hot_spring", "gorge", "arch", "peak"],
  beach: ["beach"],
};
const NOTABLE_HISTORIC = new Set(["battlefield", "fort", "castle", "monument", "archaeological_site", "ship", "wreck", "ruins", "manor", "mine", "locomotive"]);

/** As few Overpass statements as possible for the chosen categories (each costs an index scan per box). */
function overpassStatements(cats: AttractionCategory[]): string[] {
  const s: string[] = [];
  const tourism = cats.flatMap((c) => TOURISM[c] ?? []);
  if (tourism.length) s.push(`["tourism"~"^(${tourism.join("|")})$"]`);
  const natural = cats.flatMap((c) => NATURAL[c] ?? []);
  if (natural.length) s.push(`["natural"~"^(${natural.join("|")})$"]["name"]`);
  if (cats.includes("nature")) s.push('["leisure"="nature_reserve"]["name"]', '["boundary"="national_park"]["name"]');
  if (cats.includes("heritage")) s.push('["historic"]["name"]');
  if (cats.includes("wine")) s.push('["craft"="winery"]["name"]');
  if (cats.includes("food")) s.push('["shop"="farm"]["name"]', '["amenity"~"^(restaurant|cafe)$"]["name"]["website"]');
  if (cats.includes("fuel")) s.push('["amenity"="fuel"]');
  return s;
}

/** Drop the long tail that the broad statements above let through. */
function worthListing(t: Record<string, string>, kind: string): boolean {
  if (kind === "viewpoint" || kind === "fuel") return true;
  if (!t.name) return false;
  if (kind === "peak") return !!t.wikidata;
  if (t.historic && !t.tourism) return NOTABLE_HISTORIC.has(t.historic) || !!t.wikidata;
  return true;
}

/** Base appeal by category/kind; fuel and food are utilities rather than sights. */
const BASE: Record<string, number> = {
  national_park: 8,
  protected_area: 4,
  theme_park: 4,
  zoo: 4,
  aquarium: 4,
  attraction: 3,
  nature_reserve: 3,
  waterfall: 3.5,
  hot_spring: 3,
  cave_entrance: 2.5,
  gorge: 3,
  viewpoint: 2,
  museum: 2.5,
  gallery: 1.5,
  battlefield: 3,
  wine_cellar: 2.5,
  winery: 2.5,
  beach: 2.5,
  peak: 1.5,
  camp_site: 1,
  caravan_site: 0.8,
  farm: 1.2,
  restaurant: 0.6,
  cafe: 0.6,
  fuel: 0,
};

function classify(t: Record<string, string>): { category: AttractionCategory; kind: string } | null {
  if (t.amenity === "fuel") return { category: "fuel", kind: "fuel" };
  if (t.boundary === "national_park" || t.boundary === "protected_area") return { category: "nature", kind: t.boundary };
  if (t.leisure === "nature_reserve") return { category: "nature", kind: "nature_reserve" };
  if (t.tourism === "viewpoint") return { category: "viewpoint", kind: "viewpoint" };
  if (t.tourism === "museum" || t.tourism === "gallery") return { category: "museum", kind: t.tourism };
  if (t.tourism === "wine_cellar" || t.craft === "winery" || t.shop === "wine") return { category: "wine", kind: t.craft === "winery" ? "winery" : "wine_cellar" };
  if (t.tourism && ["attraction", "theme_park", "zoo", "aquarium"].includes(t.tourism)) return { category: "attraction", kind: t.tourism };
  if (t.natural === "beach") return { category: "beach", kind: "beach" };
  if (t.natural) return { category: "nature", kind: t.natural };
  if (t.historic) return { category: "heritage", kind: t.historic };
  if (t.tourism === "camp_site" || t.tourism === "caravan_site") return { category: "camping", kind: t.tourism };
  if (t.shop === "farm") return { category: "food", kind: "farm" };
  if (t.amenity === "restaurant" || t.amenity === "cafe") return { category: "food", kind: t.amenity };
  return null;
}

function tagScore(t: Record<string, string>, kind: string): number {
  let s = BASE[kind] ?? 1;
  if (t.wikidata) s += 3;
  if (t.wikipedia) s += 2;
  if (t.website || t["contact:website"]) s += 1;
  if (t.opening_hours) s += 0.5;
  if (t.image || t.wikimedia_commons) s += 0.5;
  if (t.description) s += 0.5;
  if (t.tourism === "attraction" && t.historic) s += 1; // tagged as both: notable heritage sight
  s += Math.min(2, Object.keys(t).length / 10);
  return s;
}

const sitelinkCache = new Map<string, number>();

async function sitelinks(ids: string[]): Promise<Map<string, number>> {
  const need = [...new Set(ids)].filter((id) => /^Q\d+$/.test(id) && !sitelinkCache.has(id));
  for (let i = 0; i < need.length; i += 50) {
    const batch = need.slice(i, i + 50);
    try {
      const params = new URLSearchParams({ action: "wbgetentities", ids: batch.join("|"), props: "sitelinks", format: "json" });
      const res = await fetchJson<{ entities: Record<string, { sitelinks?: Record<string, unknown> }> }>(
        `${config.wikidataUrl}?${params}`,
        { timeoutMs: 12000, cacheMs: 7 * 24 * 3600_000, retries: 0 },
      );
      for (const id of batch) sitelinkCache.set(id, Object.keys(res.entities?.[id]?.sitelinks ?? {}).length);
    } catch {
      // popularity enrichment is best-effort
      break;
    }
  }
  const out = new Map<string, number>();
  for (const id of ids) if (sitelinkCache.has(id)) out.set(id, sitelinkCache.get(id)!);
  return out;
}

export interface AttractionQuery {
  legs: string[];
  radiusKm: number;
  categories: AttractionCategory[];
  limit?: number;
}

/**
 * A search split into sections along the route, so results can be delivered (and failures
 * retried) one stretch of road at a time. Sections are numbered from the start of the trip.
 */
export interface AttractionSearch {
  sections: string[][]; // Overpass bbox strings per section
  run: (index: number, attempts?: number) => Promise<Attraction[]>;
}

/**
 * Route length covered by one section. Wider search radii make each box bigger, so the
 * stretch gets shorter to keep every Overpass query a manageable size.
 */
export function sectionLengthM(radiusKm: number): number {
  return Math.max(30_000, 120_000 - radiusKm * 3000);
}

const QUERY_TIMEOUT_S = 50;
/** How many times a box that keeps timing out may be halved. */
const MAX_SPLIT_DEPTH = 2;

export function planAttractionSearch(q: AttractionQuery): AttractionSearch {
  const line: LatLng[] = [];
  for (const enc of q.legs) {
    const pts = decodePolyline(enc);
    if (line.length && pts.length) pts.shift();
    line.push(...pts);
  }
  if (line.length < 2) return { sections: [], run: async () => [] };
  const radiusM = q.radiusKm * 1000;
  const cats = q.categories.length ? q.categories : ALL_CATEGORIES.filter((c) => c !== "fuel" && c !== "food");
  const filters = overpassStatements(cats);
  const sections = corridorBoxes(line, radiusM, sectionLengthM(q.radiusKm)).map((b) => [b]);
  const statements = (b: string) => filters.map((f) => `nwr${f}(${b});`).join("");
  const fine = simplify(line, 40);
  const cum = cumulativeDistances(fine);

  /** Fetch one box; on timeouts split it in half and fetch the halves instead. */
  const fetchBox = async (box: string, attempts: number, depth: number): Promise<OsmElement[]> => {
    const query = `[out:json][timeout:${QUERY_TIMEOUT_S}];(${statements(box)});out center tags qt;`;
    let lastErr: unknown;
    for (let a = 0; a < attempts; a++) {
      if (a > 0) await new Promise((r) => setTimeout(r, 2000 * a)); // mirrors often recover within seconds
      try {
        // one mirror per attempt; the next attempt rotates to another mirror
        return await overpass(query, (QUERY_TIMEOUT_S + 10) * 1000, 1);
      } catch (e) {
        lastErr = e;
        if (isOverloadError(e) && depth < MAX_SPLIT_DEPTH) break; // too big: retrying won't help, split it
      }
    }
    if (isOverloadError(lastErr) && depth < MAX_SPLIT_DEPTH) {
      const halves = splitBox(box);
      const parts = [];
      for (const h of halves) parts.push(await fetchBox(h, attempts, depth + 1));
      return parts.flat();
    }
    throw lastErr instanceof Error ? lastErr : new Error("Map data service unavailable");
  };

  const run = async (index: number, attempts = 3): Promise<Attraction[]> => {
    const els = (await Promise.all(sections[index].map((b) => fetchBox(b, attempts, 0)))).flat();
    return rank(toCandidates(els, cats, fine, cum, radiusM), radiusM, cats, q.limit ?? 300);
  };
  return { sections, run };
}

type Candidate = Attraction & { _wd?: string };

function toCandidates(els: OsmElement[], cats: AttractionCategory[], fine: LatLng[], cum: number[], radiusM: number): Candidate[] {
  const out: Candidate[] = [];
  for (const e of els) {
    const t = e.tags ?? {};
    const pos = elementLatLng(e);
    if (!pos) continue;
    const cls = classify(t);
    if (!cls || !cats.includes(cls.category) || !worthListing(t, cls.kind)) continue;
    const near = nearestOnLine(pos, fine, cum);
    if (near.dist > radiusM) continue;
    out.push({
      id: `${e.type}/${e.id}`,
      name: t.name ?? t["name:en"] ?? (cls.kind === "viewpoint" ? "Viewpoint" : cls.kind === "fuel" ? t.brand ?? "Fuel station" : "Unnamed"),
      lat: pos[0],
      lng: pos[1],
      category: cls.category,
      kind: cls.kind,
      distanceFromRoute: Math.round(near.dist),
      detour: Math.round(near.dist * 2 * 1.3),
      along: Math.round(near.along),
      popularity: tagScore(t, cls.kind),
      website: t.website ?? t["contact:website"],
      wikipedia: wikiUrl(t.wikipedia),
      description: t.description,
      openingHours: t.opening_hours,
      _wd: t.wikidata,
    });
  }
  return out;
}

/** Popularity enrichment, de-duplication and per-category caps. */
async function rank(candidates: Candidate[], radiusM: number, cats: AttractionCategory[], limit: number): Promise<Attraction[]> {
  const topWd = candidates
    .filter((c) => c._wd)
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 200)
    .map((c) => c._wd!);
  const links = await sitelinks(topWd);
  for (const c of candidates) {
    const n = c._wd ? links.get(c._wd) : undefined;
    if (n) c.popularity += Math.log2(1 + n) * 1.5;
    // slight preference for things close to the road
    c.popularity -= Math.min(1.5, c.distanceFromRoute / Math.max(radiusM, 1));
    c.popularity = Math.round(c.popularity * 10) / 10;
    delete c._wd;
  }
  return dedupeAndCap(candidates, cats, limit);
}

/** Drop same-named places very close together (e.g. a reserve tagged as node and area) and cap per category. */
export function dedupeAndCap(list: Attraction[], cats: AttractionCategory[], limit: number): Attraction[] {
  const byKey = new Map<string, Attraction>();
  const ids = new Set<string>();
  for (const c of [...list].sort((a, b) => b.popularity - a.popularity)) {
    if (ids.has(c.id)) continue;
    ids.add(c.id);
    const key = `${c.name.toLowerCase()}|${c.category}|${Math.round(c.lat * 50)}|${Math.round(c.lng * 50)}`;
    if (c.name !== "Viewpoint" && byKey.has(key)) continue;
    byKey.set(key + (c.name === "Viewpoint" ? c.id : ""), c);
  }
  // keep a fair share per category so one dense category doesn't crowd out the rest
  const perCat = new Map<string, number>();
  const capPerCat = Math.max(40, Math.ceil(limit / Math.max(1, cats.length)) * 2);
  const out: Attraction[] = [];
  for (const a of byKey.values()) {
    const n = perCat.get(a.category) ?? 0;
    if (n >= capPerCat) continue;
    perCat.set(a.category, n + 1);
    out.push(a);
    if (out.length >= limit) break;
  }
  return out;
}

export interface AttractionResult {
  attractions: Attraction[];
  /** true when some parts of the route could not be searched */
  partial: boolean;
  warning?: string;
}

/** Whole search in one response (used by the smoke test and non-streaming clients). */
export async function attractionsNear(q: AttractionQuery): Promise<AttractionResult> {
  const search = planAttractionSearch(q);
  const results = await mapLimit(search.sections, 3, (_s, i) => search.run(i).catch(() => null));
  const failed = results.filter((r) => r === null).length;
  if (failed && failed === results.length) throw new UpstreamError("Map data service unavailable — try again shortly", 503);
  const cats = q.categories.length ? q.categories : ALL_CATEGORIES.filter((c) => c !== "fuel" && c !== "food");
  return {
    attractions: dedupeAndCap(results.flatMap((r) => r ?? []), cats, q.limit ?? 300),
    partial: failed > 0,
    warning: failed ? `Part of the route (${failed} of ${results.length} sections) couldn't be searched right now — try again shortly.` : undefined,
  };
}

function wikiUrl(tag?: string): string | undefined {
  if (!tag) return undefined;
  const m = tag.match(/^([a-z-]+):(.+)$/);
  if (!m) return undefined;
  return `https://${m[1]}.wikipedia.org/wiki/${encodeURIComponent(m[2].replace(/ /g, "_"))}`;
}

export type { OsmElement };
