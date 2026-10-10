import type {
  Attraction,
  AttractionCategory,
  RoadIssue,
  RouteAlternative,
  RoutePlan,
  SavedRoute,
  SavedRouteSummary,
  Trip,
  Visibility,
} from "../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Padkos": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Can't reach the Padkos server. Check your connection and try again.", 0);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON error page
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export interface GeoResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
  kind: "address" | "poi" | "city" | "attraction" | "custom";
  city?: string;
  province?: string;
}

export type AttractionEvent =
  | { type: "start"; total: number; sections: number[] }
  | { type: "section"; index: number; attractions: Attraction[] }
  | { type: "section-error"; index: number; error: string }
  | { type: "retrying"; sections: number[] }
  | { type: "done"; failed: number[] };

export interface User {
  id: string;
  username: string;
}

interface PlanPoint {
  lat: number;
  lng: number;
  name?: string;
}

export const api = {
  config: () => call<{ maxStops: number; liveTraffic: boolean; routingServer: string }>("GET", "/config"),
  search: (q: string, near?: { lat: number; lng: number }, signal?: AbortSignal) =>
    call<{ results: GeoResult[] }>(
      "GET",
      `/geocode/search?q=${encodeURIComponent(q)}${near ? `&lat=${near.lat}&lng=${near.lng}` : ""}`,
      undefined,
      signal,
    ).then((r) => r.results),
  reverse: (lat: number, lng: number) => call<{ result: GeoResult }>("GET", `/geocode/reverse?lat=${lat}&lng=${lng}`).then((r) => r.result),
  plan: (body: {
    start: PlanPoint;
    end: PlanPoint | null;
    stops: PlanPoint[];
    optimize: boolean;
    optimizeBy: "duration" | "distance";
    roundTrip: boolean;
  }) => call<{ plan: RoutePlan }>("POST", "/plan", body).then((r) => r.plan),
  alternatives: (from: PlanPoint, to: PlanPoint) =>
    call<{ alternatives: RouteAlternative[] }>("POST", "/alternatives", { from, to }).then((r) => r.alternatives),
  insertion: (body: { start: PlanPoint; end: PlanPoint; stops: PlanPoint[]; point: PlanPoint; legDurations?: number[] }) =>
    call<{ index: number }>("POST", "/insertion", body).then((r) => r.index),
  /**
   * Search for attractions section by section along the route, calling `onEvent` as each
   * stretch of road comes back. Throws if the connection drops before the search finishes.
   */
  attractionsStream: async (
    body: { legs: string[]; radiusKm: number; categories: AttractionCategory[]; sections?: number[] },
    onEvent: (e: AttractionEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> => {
    let res: Response;
    try {
      res = await fetch("/api/attractions/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Padkos": "1" },
        body: JSON.stringify(body),
        credentials: "same-origin",
        signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new ApiError("Can't reach the Padkos server. Check your connection and try again.", 0);
    }
    if (!res.ok || !res.body) {
      let msg = `Search failed (${res.status})`;
      try {
        msg = (await res.json()).error ?? msg;
      } catch {
        // not JSON (e.g. a proxy error page)
      }
      throw new ApiError(msg, res.status);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    let finished = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const event = JSON.parse(line) as AttractionEvent;
        if (event.type === "done") finished = true;
        onEvent(event);
      }
    }
    if (!finished) throw new ApiError("The connection dropped before the search finished.", 0);
  },
  roadworks: (legs: string[], signal?: AbortSignal) =>
    call<{ issues: RoadIssue[]; sources: { osm: boolean; tomtom: boolean }; errors: string[] }>("POST", "/roadworks", { legs }, signal),

  me: () => call<{ user: User | null }>("GET", "/auth/me").then((r) => r.user),
  login: (username: string, password: string) => call<{ user: User }>("POST", "/auth/login", { username, password }).then((r) => r.user),
  register: (username: string, password: string) => call<{ user: User }>("POST", "/auth/register", { username, password }).then((r) => r.user),
  logout: () => call<{ ok: true }>("POST", "/auth/logout", {}),

  myRoutes: () => call<{ routes: SavedRouteSummary[] }>("GET", "/routes").then((r) => r.routes),
  getRoute: (id: string, token?: string) =>
    call<{ route: SavedRoute }>("GET", `/routes/${encodeURIComponent(id)}${token ? `?token=${encodeURIComponent(token)}` : ""}`).then((r) => r.route),
  shared: (token: string) => call<{ route: SavedRoute }>("GET", `/shared/${encodeURIComponent(token)}`).then((r) => r.route),
  createRoute: (trip: Trip, plan: RoutePlan | null, visibility: Visibility) =>
    call<{ route: SavedRoute }>("POST", "/routes", { trip, plan, visibility }).then((r) => r.route),
  updateRoute: (id: string, patch: { trip?: Trip; plan?: RoutePlan | null; visibility?: Visibility }) =>
    call<{ route: SavedRoute }>("PUT", `/routes/${encodeURIComponent(id)}`, patch).then((r) => r.route),
  deleteRoute: (id: string) => call<{ ok: true }>("DELETE", `/routes/${encodeURIComponent(id)}`),
  rotateShareToken: (id: string) => call<{ shareToken: string }>("POST", `/routes/${encodeURIComponent(id)}/share-token`, {}).then((r) => r.shareToken),
  vote: (id: string, value: 1 | -1 | 0, token?: string) =>
    call<{ score: number; upvotes: number; downvotes: number; myVote: number }>("POST", `/routes/${encodeURIComponent(id)}/vote`, { value, token }),
  copyRoute: (id: string, token?: string) => call<{ route: SavedRoute }>("POST", `/routes/${encodeURIComponent(id)}/copy`, { token }).then((r) => r.route),
  community: (params: { sort: string; q?: string; province?: string; page?: number }) => {
    const qs = new URLSearchParams({ sort: params.sort, page: String(params.page ?? 1) });
    if (params.q) qs.set("q", params.q);
    if (params.province) qs.set("province", params.province);
    return call<{ routes: SavedRouteSummary[]; total: number; page: number; pageSize: number }>("GET", `/community?${qs}`);
  },
};
