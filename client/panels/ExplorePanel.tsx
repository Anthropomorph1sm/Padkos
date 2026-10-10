import { useMemo, useState } from "react";
import type { Attraction, AttractionCategory } from "../../shared/types";
import { distanceShort, km } from "../format";

export const CATEGORY_LABELS: Record<AttractionCategory, string> = {
  attraction: "Attractions",
  nature: "Parks & nature",
  viewpoint: "Viewpoints",
  museum: "Museums",
  heritage: "Heritage",
  wine: "Wine farms",
  beach: "Beaches",
  camping: "Camping",
  food: "Farm stalls & food",
  fuel: "Fuel stations",
};
export const DEFAULT_CATEGORIES: AttractionCategory[] = ["attraction", "nature", "viewpoint", "museum", "heritage", "wine", "beach"];

export interface ExploreState {
  loading: boolean;
  list: Attraction[] | null;
  /** sections the route is split into, and which are done, failed or still searching */
  total: number;
  done: number[];
  failed: number[];
  pending: number[];
  /** the whole request failed before any section started */
  error?: string;
  /** the connection dropped part-way */
  dropped?: string;
  /** the user pressed Stop */
  stopped?: boolean;
  /** the server is giving failed stretches a second try */
  retrying?: boolean;
  /** radius/categories the list was fetched with */
  key?: string;
  params?: { radiusKm: number; categories: AttractionCategory[] };
}

export const EMPTY_EXPLORE: ExploreState = { loading: false, list: null, total: 0, done: [], failed: [], pending: [] };

interface Props {
  radiusKm: number;
  setRadius: (km: number) => void;
  categories: AttractionCategory[];
  setCategories: (c: AttractionCategory[]) => void;
  state: ExploreState;
  onSearch: () => void;
  onRetry: () => void;
  onStop: () => void;
  onAdd: (a: Attraction) => void;
  onFocus: (a: Attraction) => void;
  addedIds: Set<string>;
  adding: string | null;
}

export function ExplorePanel({ radiusKm, setRadius, categories, setCategories, state, onSearch, onRetry, onStop, onAdd, onFocus, addedIds, adding }: Props) {
  const [sort, setSort] = useState<"popular" | "route">("popular");
  const [filter, setFilter] = useState("");
  const key = `${radiusKm}|${[...categories].sort().join(",")}`;
  const stale = state.list && state.key !== key;

  const shown = useMemo(() => {
    if (!state.list) return [];
    const f = filter.trim().toLowerCase();
    const l = state.list.filter((a) => categories.includes(a.category) && a.distanceFromRoute <= radiusKm * 1000 && (!f || a.name.toLowerCase().includes(f)));
    return sort === "popular" ? l : [...l].sort((a, b) => a.along - b.along);
  }, [state.list, filter, sort, categories, radiusKm]);

  const toggle = (c: AttractionCategory) =>
    setCategories(categories.includes(c) ? categories.filter((x) => x !== c) : [...categories, c]);

  return (
    <>
      <div className="section">
        <label className="field">
          <span className="row" style={{ justifyContent: "space-between" }}>
            <span>Search radius around the route (max detour)</span>
            <span className="num">{radiusKm} km</span>
          </span>
          <input
            className="range"
            type="range"
            min={1}
            max={50}
            step={1}
            value={radiusKm}
            onChange={(e) => setRadius(Number(e.target.value))}
            aria-valuetext={`${radiusKm} kilometres`}
          />
        </label>
        <p className="small muted" style={{ margin: 0 }}>
          A place {radiusKm} km off the road adds roughly {Math.round(radiusKm * 2.6)} km of driving there and back.
        </p>
        <div className="chips" role="group" aria-label="Categories">
          {(Object.keys(CATEGORY_LABELS) as AttractionCategory[]).map((c) => (
            <button key={c} className="chip" aria-pressed={categories.includes(c)} onClick={() => toggle(c)}>
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
        {state.loading ? (
          <button className="btn" onClick={onStop}>
            <span className="spinner" /> Stop searching
          </button>
        ) : (
          <button className="btn primary" onClick={onSearch} disabled={categories.length === 0}>
            {state.list && !stale ? "Search again" : "Find places along the route"}
          </button>
        )}
        {state.total > 0 && (state.loading || state.failed.length > 0) && (
          <div className="progress" role="status">
            <div className="progress-bar" aria-hidden="true">
              <span style={{ width: `${(state.done.length / state.total) * 100}%` }} />
              <span className="failed" style={{ width: `${(state.failed.length / state.total) * 100}%` }} />
            </div>
            <span className="small muted">
              {state.loading && state.retrying
                ? `Trying ${state.pending.length} busy stretch${state.pending.length === 1 ? "" : "es"} again, ${state.list?.length ?? 0} places so far`
                : state.loading
                ? `Searched ${state.done.length} of ${state.total} stretches of the route${state.list?.length ? `, ${state.list.length} places so far` : ""}`
                : `Searched ${state.done.length} of ${state.total} stretches`}
            </span>
          </div>
        )}
        {stale && !state.loading && <div className="notice">You changed the radius or categories — search again to include them.</div>}
        {state.error && <div className="notice error">{state.error}</div>}
        {!state.loading && state.failed.length > 0 && (
          <div className="notice row wrap" style={{ justifyContent: "space-between" }}>
            <span>
              {state.stopped
                ? `Search stopped with ${state.failed.length === 1 ? "one stretch" : `${state.failed.length} stretches`} of the route left.`
                : `${state.dropped ? `${state.dropped} ` : ""}${state.failed.length === 1 ? "One stretch" : `${state.failed.length} stretches`} of the route couldn't be searched — the map data service is busy.`}
            </span>
            <button className="btn small primary" onClick={onRetry}>
              {state.stopped ? "Search the rest" : `Retry ${state.failed.length === 1 ? "it" : `those ${state.failed.length}`}`}
            </button>
          </div>
        )}
      </div>

      {state.list && (
        <div className="section">
          <div className="row wrap">
            <input className="input grow" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter places by name" />
            <div className="segmented" role="group" aria-label="Sort places">
              <button aria-pressed={sort === "popular"} onClick={() => setSort("popular")}>
                Most popular
              </button>
              <button aria-pressed={sort === "route"} onClick={() => setSort("route")}>
                Along the way
              </button>
            </div>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            {shown.length} place{shown.length === 1 ? "" : "s"}. Popularity weighs Wikipedia coverage and how well the place is documented on OpenStreetMap.
          </p>
          {shown.length === 0 && !state.loading && <p className="small">Nothing matches. Try a wider radius or more categories.</p>}
          {shown.length === 0 && state.loading && <p className="small muted">Places appear here as each stretch of the route is searched.</p>}
          <ul className="list">
            {shown.map((a) => (
              <li key={a.id}>
                <div className="item">
                  <span className="plate brown" title={CATEGORY_LABELS[a.category]}>
                    {CATEGORY_LABELS[a.category].charAt(0)}
                  </span>
                  <div>
                    <button className="btn ghost small" style={{ padding: 0, minHeight: 0, fontSize: "var(--step-0)" }} onClick={() => onFocus(a)}>
                      <span className="item-title">{a.name}</span>
                    </button>
                    <div className="small muted">
                      {a.kind.replace(/_/g, " ")} ∙ {distanceShort(a.distanceFromRoute)} off the route ∙ ≈{km(a.detour)} detour ∙ {km(a.along)} into the trip
                    </div>
                    <div className="small row wrap" style={{ gap: 10 }}>
                      {a.wikipedia && (
                        <a href={a.wikipedia} target="_blank" rel="noreferrer">
                          Wikipedia
                        </a>
                      )}
                      {a.website && (
                        <a href={a.website.startsWith("http") ? a.website : `https://${a.website}`} target="_blank" rel="noreferrer">
                          Website
                        </a>
                      )}
                      {a.openingHours && <span className="muted">Hours: {a.openingHours}</span>}
                    </div>
                  </div>
                  <button className="btn small" onClick={() => onAdd(a)} disabled={addedIds.has(a.id) || adding !== null}>
                    {adding === a.id ? <span className="spinner" /> : addedIds.has(a.id) ? "Added" : "Add"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="small muted">Places © OpenStreetMap contributors; popularity from Wikidata.</p>
        </div>
      )}
    </>
  );
}
