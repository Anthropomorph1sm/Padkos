// Live smoke test against a running Padkos server and the real map services.
//   npm run smoke                      (server on http://localhost:8787)
//   BASE=https://padkos.example npm run smoke
import { isInSouthAfrica } from "../shared/southAfrica";
import { findTolls, totalTolls } from "../shared/tolls";
import { distinguishingTowns } from "../shared/towns";

const BASE = (process.env.BASE ?? "http://localhost:8787").replace(/\/$/, "") + "/api";
const H = { "Content-Type": "application/json", "X-Padkos": "1" };
let failures = 0;

async function check(label: string, fn: () => Promise<string>) {
  const t0 = Date.now();
  try {
    const result = await fn();
    console.log(`✔ ${label} (${Date.now() - t0} ms): ${result}`);
  } catch (e) {
    failures++;
    console.log(`✘ ${label}: ${(e as Error).message}`);
  }
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(BASE + path, { method: "POST", headers: H, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.status);
  return j as T;
}

await check("geocode", async () => {
  const r = await (await fetch(`${BASE}/geocode/search?q=Clarens`)).json();
  if (!r.results?.length) throw new Error("no results");
  return `${r.results[0].name}, ${r.results[0].address}`;
});

let legs: string[] = [];
await check("plan 100 stops", async () => {
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const stops: { lat: number; lng: number }[] = [];
  while (stops.length < 100) {
    const lat = -34 + rnd() * 11.5, lng = 18 + rnd() * 14;
    if (isInSouthAfrica(lat, lng)) stops.push({ lat, lng });
  }
  const t0 = Date.now();
  const { plan } = await post<{ plan: { legs: { geometry: string }[]; distance: number } }>("/plan", {
    start: { lat: -33.9249, lng: 18.4241 },
    end: { lat: -26.2041, lng: 28.0473 },
    stops,
    optimize: true,
  });
  return `${plan.legs.length} legs, ${Math.round(plan.distance / 1000)} km in ${Date.now() - t0} ms`;
});

await check("alternatives Cape Town → Johannesburg", async () => {
  const { alternatives } = await post<{ alternatives: { geometry: string; distance: number; summary: string }[] }>("/alternatives", {
    from: { lat: -33.9249, lng: 18.4241 },
    to: { lat: -26.2041, lng: 28.0473 },
  });
  legs = [alternatives[0].geometry];
  const via = distinguishingTowns(alternatives.map((a) => a.geometry));
  return alternatives.map((a, i) => `via ${via[i] ?? "?"} ${a.summary} ${Math.round(a.distance / 1000)} km R${totalTolls(findTolls([a.geometry]))}`).join(" | ");
});

await check("road works", async () => {
  const r = await post<{ issues: unknown[]; errors: string[] }>("/roadworks", { legs });
  return `${r.issues.length} issues ${r.errors.join("; ")}`;
});

await check("attractions (10 km)", async () => {
  const r = await post<{ attractions: { name: string }[]; warning?: string }>("/attractions", { legs, radiusKm: 10, categories: [] });
  return `${r.attractions.length} places, top: ${r.attractions.slice(0, 3).map((a) => a.name).join(", ")} ${r.warning ?? ""}`;
});

process.exit(failures ? 1 : 0);
