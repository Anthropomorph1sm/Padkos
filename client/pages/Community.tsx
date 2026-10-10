import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { RouteCard } from "../components/RouteCard";
import type { SavedRouteSummary } from "../../shared/types";

const PROVINCES = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Western Cape",
];

const SORTS = [
  { id: "popular", label: "Popular now" },
  { id: "top", label: "Top rated" },
  { id: "new", label: "Newest" },
];

export function Community() {
  const [params, setParams] = useSearchParams();
  const sort = params.get("sort") ?? "popular";
  const province = params.get("province") ?? "";
  const page = Number(params.get("page") ?? 1);
  const [q, setQ] = useState(params.get("q") ?? "");
  const [data, setData] = useState<{ routes: SavedRouteSummary[]; total: number; pageSize: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next);
  };

  useEffect(() => {
    let live = true;
    setError(null);
    api
      .community({ sort, province: province || undefined, q: params.get("q") ?? undefined, page })
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [sort, province, page, params]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <main className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Community routes</h1>
            <p className="muted" style={{ margin: "4px 0 0", maxWidth: "60ch" }}>
              Road trips other travellers have shared. Vote for the good ones, and copy any route into your own trips to make it yours.
            </p>
          </div>
        </div>

        <div className="toolbar">
          <div className="segmented" role="group" aria-label="Sort routes">
            {SORTS.map((s) => (
              <button key={s.id} aria-pressed={sort === s.id} onClick={() => set({ sort: s.id === "popular" ? null : s.id })}>
                {s.label}
              </button>
            ))}
          </div>
          <select className="input" style={{ width: "auto" }} value={province} onChange={(e) => set({ province: e.target.value || null })} aria-label="Province">
            <option value="">All provinces</option>
            {PROVINCES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <form
            className="row grow"
            style={{ minWidth: 220 }}
            onSubmit={(e) => {
              e.preventDefault();
              set({ q: q.trim() || null });
            }}
          >
            <input className="input grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or town" aria-label="Search routes" />
            <button className="btn" type="submit">
              Search
            </button>
          </form>
        </div>

        {error && <div className="notice error">{error}</div>}
        {data && data.routes.length === 0 && (
          <div className="empty">
            <h3>No public routes {params.get("q") || province ? "match that" : "yet"}</h3>
            <p style={{ margin: 0 }}>Plan a trip, then choose Public under Save &amp; share to be the first.</p>
            <Link className="btn primary" to="/">
              Plan a trip
            </Link>
          </div>
        )}
        {data && data.routes.length > 0 && (
          <>
            <ul className="route-cards">
              {data.routes.map((r) => (
                <RouteCard key={r.id} r={r} />
              ))}
            </ul>
            {pages > 1 && (
              <nav className="pager" aria-label="Pages">
                <button className="btn small" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
                  Previous
                </button>
                <span className="small num">
                  Page {page} of {pages}
                </span>
                <button className="btn small" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>
                  Next
                </button>
              </nav>
            )}
          </>
        )}
        {!data && !error && (
          <p className="muted row">
            <span className="spinner" /> Loading routes…
          </p>
        )}
      </div>
    </main>
  );
}
