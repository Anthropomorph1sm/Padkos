import path from "node:path";

// Load ./.env when present (Node's built-in loader; real environment variables win).
try {
  process.loadEnvFile();
} catch {
  // no .env file — defaults apply
}

const env = process.env;
const int = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
const list = (v: string | undefined, d: string[]) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : d);

export const config = {
  port: int(env.PORT, 8787),
  production: env.NODE_ENV === "production",
  dbPath: env.DB_PATH ?? path.resolve("data", "padkos.db"),

  /** OSRM routing server. The public demo works for light use; self-host for production (see README). */
  osrmUrl: (env.OSRM_URL ?? "https://router.project-osrm.org").replace(/\/$/, ""),
  osrmProfile: env.OSRM_PROFILE ?? "driving",
  /** --max-table-size of the OSRM server (the demo server uses 100). */
  osrmMaxTable: int(env.OSRM_MAX_TABLE, 100),
  /** Waypoints per /route request; longer trips are routed in overlapping chunks. */
  osrmMaxWaypoints: int(env.OSRM_MAX_WAYPOINTS, 50),

  photonUrl: (env.PHOTON_URL ?? "https://photon.komoot.io").replace(/\/$/, ""),
  nominatimUrl: (env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org").replace(/\/$/, ""),
  overpassUrls: list(env.OVERPASS_URLS, [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
  ]),
  wikidataUrl: env.WIKIDATA_URL ?? "https://www.wikidata.org/w/api.php",

  /** Optional: enables live traffic incidents and road works from TomTom. */
  tomtomKey: env.TOMTOM_API_KEY ?? "",

  /** Identify the app to OpenStreetMap services as their usage policies require. */
  userAgent: env.APP_USER_AGENT ?? "PadkosRoadTripPlanner/1.0 (self-hosted)",

  /** Express "trust proxy" setting: which hops may set X-Forwarded-For (rate limits key on the client IP). */
  trustProxy: env.TRUST_PROXY ?? "loopback",

  sessionDays: int(env.SESSION_DAYS, 30),
  /** Radius (m) around obscured places within which shared route geometry is removed. */
  privacyRadiusM: int(env.PRIVACY_RADIUS_M, 5000),
};
