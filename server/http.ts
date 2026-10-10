// Outbound HTTP: timeouts, retries, a TTL cache and per-host rate limiting.
import { config } from "./config";

export class UpstreamError extends Error {
  constructor(
    message: string,
    public status = 502,
    public upstream?: string,
  ) {
    super(message);
  }
}

class TtlCache<V> {
  private map = new Map<string, { v: V; exp: number }>();
  constructor(private max = 2000) {}
  get(k: string): V | undefined {
    const hit = this.map.get(k);
    if (!hit) return undefined;
    if (hit.exp < Date.now()) {
      this.map.delete(k);
      return undefined;
    }
    // refresh LRU position
    this.map.delete(k);
    this.map.set(k, hit);
    return hit.v;
  }
  set(k: string, v: V, ttlMs: number) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value!);
    this.map.set(k, { v, exp: Date.now() + ttlMs });
  }
  clear() {
    this.map.clear();
  }
}

const cache = new TtlCache<unknown>(3000);
export const clearHttpCache = () => cache.clear();

/** Serialise requests per host with a minimum gap (e.g. Nominatim's 1 request / second policy). */
const hostQueues = new Map<string, Promise<void>>();
const MIN_GAP_MS: Record<string, number> = {
  "nominatim.openstreetmap.org": 1100,
};

async function throttle(host: string): Promise<void> {
  const gap = MIN_GAP_MS[host];
  if (!gap) return;
  const prev = hostQueues.get(host) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  hostQueues.set(host, prev.then(() => next));
  await prev;
  setTimeout(release, gap);
}

export interface FetchOpts {
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** cache successful responses for this long */
  cacheMs?: number;
  retries?: number;
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T> {
  const key = `${opts.method ?? "GET"} ${url} ${opts.body ?? ""}`;
  if (opts.cacheMs) {
    const hit = cache.get(key);
    if (hit !== undefined) return hit as T;
  }
  const host = new URL(url).host;
  const retries = opts.retries ?? 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(host);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        body: opts.body,
        headers: { "User-Agent": config.userAgent, Accept: "application/json", ...opts.headers },
        signal: ctrl.signal,
      });
      const textBody = await res.text();
      if (!res.ok) {
        // OSRM returns useful JSON errors with 400 status
        let msg = `${host} responded ${res.status}`;
        try {
          const j = JSON.parse(textBody);
          if (j?.message) msg = j.message;
          if (res.status === 400 && j?.code) {
            throw new UpstreamError(msg, 400, host);
          }
        } catch (e) {
          if (e instanceof UpstreamError) throw e;
        }
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          lastErr = new UpstreamError(msg, 502, host);
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          continue;
        }
        throw new UpstreamError(msg, res.status === 429 ? 503 : 502, host);
      }
      let data: T;
      try {
        data = JSON.parse(textBody) as T;
      } catch {
        throw new UpstreamError(`${host} returned invalid JSON`, 502, host);
      }
      if (opts.cacheMs) cache.set(key, data, opts.cacheMs);
      return data;
    } catch (e) {
      if (e instanceof UpstreamError && e.status === 400) throw e;
      lastErr =
        e instanceof UpstreamError
          ? e
          : new UpstreamError(
              (e as Error).name === "AbortError" ? `${host} timed out` : `${host} unreachable: ${(e as Error).message}`,
              504,
              host,
            );
      if (attempt < retries) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** Run async tasks with limited concurrency, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
