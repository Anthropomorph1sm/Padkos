# Padkos: a South African road-trip planner

Plan road trips across South Africa with up to 100 stops. Padkos puts the stops in the best order, gives turn-by-turn directions with a day-by-day schedule, adds up fuel and toll costs, finds attractions along the way, and lets you share routes without giving away your home address.

## What it does

| | |
|---|---|
| **Route planning** | Start, destination and up to **100 stops**. Stops are put in the best order by time or by distance; you can also keep your own order or drag stops around. Round trips work too. Add stops by search, by clicking the map, or by pasting a list of place names. |
| **Directions & times** | Turn-by-turn directions per leg. A schedule built from your departure time, how long you stay at each stop and your daily driving limit shows where you'll sleep. Printable. |
| **Tolls** | Every toll plaza the route passes (63 SA plazas, positions from OpenStreetMap), with approximate Class 1 fees you can edit. Ramp plazas only count when the route uses the ramp. |
| **Road works** | Roads under construction near the route, from OpenStreetMap. Add a TomTom API key for live closures, road works and incidents. |
| **Fuel cost** | Economy in L/100 km or km/L (switching converts the number), fuel type, pump price with inland/coastal presets, tank size → fill-ups needed, cost per person. |
| **Alternative routes** | For each leg, up to three alternatives, compared on time, distance and tolls ("via Kimberley: +1 h 27 min, −R203 tolls"). Pick one to use it. |
| **Attractions** | Parks, viewpoints, museums, heritage sites, wine farms, beaches, camping, farm stalls and fuel stations within a radius you set (1–50 km, the maximum detour). Ranked by popularity; "Add" inserts the place where it adds the least driving. |
| **Save, import, export** | Save trips to your account. Export GPX, KML, CSV or a full Padkos file; import any of those, or paste a Google Maps directions link. |
| **Google Maps** | Opens the whole trip in Google Maps, split into linked parts of up to 10 places (Google's limit), or any stretch you choose. |
| **Sharing & community** | Private, anyone-with-the-link, or public. Shared copies replace the start and end (and any stop you mark private) with the town they're in, cut the route line within 5 km of them, and drop directions and notes there. Public routes appear on Community routes, sorted by popular, top or new, with up/down votes, search and province filters. Anyone can copy a route into their own trips. |
| **South Africa only** | Search is limited to SA, and every point is checked against the SA border (Lesotho and Eswatini excluded) in the browser and on the server. |

## Running it

Needs **Node.js 22.13 or newer** (it uses Node's built-in SQLite).

```bash
npm install
npm run dev          # API on :8787 and web app on http://localhost:5173
```

Production (one process serving the site and the API):

```bash
npm run build
npm start            # http://localhost:8787
```

Or with Docker: `docker compose up`. (The Dockerfile and compose file pass `docker compose config`, but the images haven't been built yet. Treat them as a starting point.)

Data lives in `data/padkos.db` (SQLite). No API keys are needed: by default the app uses public OpenStreetMap-based services.

### Tests

```bash
npm test             # 64 unit and API tests (optimiser, geometry, tolls, formats, privacy, votes…)
npm run typecheck
npm run smoke        # live check against a running server and the real map services
```

### Deployment

Pushes to `main` run `.github/workflows/deploy.yml`: typecheck, tests and `npm audit`, then the Docker image is built on the runner and streamed over SSH to the server. The server's `padkos-deploy` key can only run `/usr/local/bin/padkos-deploy` (`deploy/padkos-deploy.sh`), which loads the image, restarts `/opt/padkos/compose.yml` (`deploy/compose.yml`) and rolls back if `/api/health` fails. nginx on the host terminates TLS and proxies to `127.0.0.1:8787`. Runtime settings live in `/opt/padkos/.env` on the server.

Repository secrets (environment `production`): `DEPLOY_SSH_KEY` (private key), `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan -t ed25519 <host>`).

## Configuration

All optional; see `.env.example`. The server reads `.env` automatically.

| Variable | Default | Purpose |
|---|---|---|
| `OSRM_URL` | `https://router.project-osrm.org` | Routing server |
| `OSRM_MAX_TABLE` | `100` | The router's `--max-table-size`; larger matrices are fetched in chunks |
| `OSRM_MAX_WAYPOINTS` | `50` | Waypoints per routing request; longer trips are routed in chunks |
| `PHOTON_URL`, `NOMINATIM_URL` | komoot / OSM | Place search and reverse geocoding |
| `OVERPASS_URLS` | three public mirrors | Map data for attractions and road works (tried in turn) |
| `TOMTOM_API_KEY` | — | Enables live traffic incidents and road works |
| `APP_USER_AGENT` | `PadkosRoadTripPlanner/1.0 (self-hosted)` | Identifies your deployment to OSM services. Put your site or contact here |
| `TRUST_PROXY` | `loopback` | Express `trust proxy`: which hops may set `X-Forwarded-For`. Use `loopback,uniquelocal` when a host proxy forwards into Docker |
| `PRIVACY_RADIUS_M` | `5000` | How much route line is removed around hidden places |
| `VITE_TILE_URL` | tile.openstreetmap.org | Map tiles (build time) |

### Before real traffic

The defaults use free, shared community servers with usage policies. They suit personal use and development, not a busy public site:

- **Routing:** run your own OSRM with South African data: `docker compose --profile osrm up`, then set `OSRM_URL=http://osrm:5000` and `OSRM_MAX_TABLE=500`.
- **Map tiles:** tile.openstreetmap.org forbids heavy use. Point `VITE_TILE_URL` at a commercial or self-hosted tile server.
- **Geocoding / Overpass:** self-host Photon/Nominatim and Overpass, or use a paid provider. Nominatim is already throttled to 1 request a second, as its policy requires.
- Put the app behind HTTPS (session cookies are `Secure` in production).

## How it works

```
client/   React + Leaflet single-page app (Vite)
server/   Express API, SQLite (node:sqlite), calls to routing and map-data services
shared/   Code used by both: optimiser, geometry, tolls, fuel, file formats, SA border, schedule
tests/    Vitest unit and API tests
```

- **More than Google's 10 stops.** The server fetches the full travel-time matrix from OSRM. Above the router's table limit it asks for blocks of rows, staying under `sources × destinations ≤ max²`. It then orders the stops itself: an exact Held–Karp search up to 12 stops; above that, cheapest-insertion and nearest-neighbour starts improved by 2-opt and Or-opt local search with random restarts. 100 stops take under a second to order and about 3 seconds end to end. Matrices handle one-way streets correctly. The final route is requested in overlapping chunks of waypoints.
- **Tolls** are matched on the client against the bundled plaza list (`shared/tollPlazas.ts`). A plaza counts when the route passes within 70 m of a booth (35 m for ramps), and each separate pass is counted.
- **Attractions** stream in as they're found. The route is cut into stretches, each a single small Overpass box sized to the search radius, so wider radii use shorter stretches. Stretches are searched three at a time in route order, and each result is sent to the browser as newline-delimited JSON (`POST /api/attractions/stream`) the moment it arrives. A stretch that times out is split in half and the halves searched; one that fails on a busy mirror is retried on the next mirror. Stretches still failing are retried once more automatically at the end. Anything left is reported, and **Retry** re-searches only those stretches. Popularity combines OSM tag richness with the number of Wikipedia language editions (Wikidata sitelinks).
- **Road works** use the same Overpass approach over the whole route, plus TomTom's incident API when a key is set.
- **Privacy:** obscured copies are made on the server when a route is shared and stored next to the original. Non-owners only ever receive the obscured copy.
- **Security:** scrypt password hashes, hashed session tokens in httpOnly SameSite cookies, a custom-header CSRF check on every write, rate limits on login and on calls that reach outside services, and zod validation on every input.

## Known limits

- Toll fees are estimates (SANRAL and the concessionaires change tariffs every March) and cover Class 1 vehicles only. Gauteng e-toll gantries are ignored because the system was switched off in 2024.
- Fuel price presets are placeholders. Prices change monthly, so check the current price.
- Without a TomTom key, road works only cover what volunteers have mapped in OpenStreetMap.
- The public routing server doesn't support "avoid tolls", so toll-free options come from the alternatives list.
- Travel times come from typical speeds, not live traffic.

Map data © OpenStreetMap contributors (ODbL). Routing by OSRM.
