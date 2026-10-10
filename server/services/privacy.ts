// Obscuring of shared routes: start, end (and stops marked private) are replaced by the
// town they are in, the route line is cut back around them, and nearby directions removed.
import { decodePolyline, encodePolyline, haversine, type LatLng } from "../../shared/geo";
import type { Place, RoutePlan, Trip } from "../../shared/types";
import { config } from "../config";
import { cityFor } from "./geocode";

export interface ObscuredResult {
  trip: Trip;
  plan: RoutePlan | null;
  startCity?: string;
  endCity?: string;
  provinces: string[];
}

/** Cut the leg geometry back so it does not come within `radius` of any secret point. */
function trimAround(line: LatLng[], secrets: LatLng[], radius: number): LatLng[][] {
  const pieces: LatLng[][] = [];
  let cur: LatLng[] = [];
  for (const p of line) {
    const hidden = secrets.some((s) => haversine(p, s) < radius);
    if (hidden) {
      if (cur.length > 1) pieces.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length > 1) pieces.push(cur);
  return pieces;
}

export async function obscureTrip(
  trip: Trip,
  plan: RoutePlan | null,
  lookup: typeof cityFor = cityFor,
  radius = config.privacyRadiusM,
): Promise<ObscuredResult> {
  const secrets: LatLng[] = [];
  const out: Trip = structuredClone(trip);
  const provinces = new Set<string>();
  let startCity: string | undefined;
  let endCity: string | undefined;

  const hide = async (p: Place) => {
    secrets.push([p.lat, p.lng]);
    const c = await lookup(p.lat, p.lng);
    if (c.province) provinces.add(c.province);
    return {
      id: p.id,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      kind: "city" as const,
      city: c.name,
      stayMinutes: p.stayMinutes,
      approximate: true,
    };
  };

  if (out.start) {
    out.start = await hide(out.start);
    startCity = out.start.name;
  }
  if (out.end && !out.settings.roundTrip) {
    out.end = await hide(out.end);
    endCity = out.end.name;
  } else if (out.settings.roundTrip) endCity = startCity;
  out.stops = await Promise.all(
    out.stops.map(async (s) => {
      if (s.private) return hide(s);
      const { notes: _n, ...rest } = s; // personal notes are never shared
      return { ...rest } as Place;
    }),
  );
  out.tollOverrides = trip.tollOverrides;

  let outPlan: RoutePlan | null = null;
  if (plan) {
    outPlan = {
      ...plan,
      legs: plan.legs.map((leg) => {
        const pieces = trimAround(decodePolyline(leg.geometry), secrets, radius);
        // Join remaining pieces into one line; gaps only occur around private stops.
        const joined = pieces.flat();
        return {
          ...leg,
          geometry: encodePolyline(joined),
          steps: leg.steps.filter((s) => !secrets.some((sec) => haversine(s.location, sec) < radius)),
        };
      }),
    };
  }
  return { trip: out, plan: outPlan, startCity, endCity, provinces: [...provinces] };
}
