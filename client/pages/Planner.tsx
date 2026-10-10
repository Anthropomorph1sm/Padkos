import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context";
import { MapView, type ClickAction, type MapAlternative } from "../components/MapView";
import { StopsPanel, MAX_STOPS } from "../panels/StopsPanel";
import { DirectionsPanel } from "../panels/DirectionsPanel";
import { AlternativesPanel } from "../panels/AlternativesPanel";
import { CostsPanel } from "../panels/CostsPanel";
import { RoadPanel, type IssuesState } from "../panels/RoadPanel";
import { ExplorePanel, DEFAULT_CATEGORIES, EMPTY_EXPLORE, type ExploreState } from "../panels/ExplorePanel";
import { SharePanel, type SavedInfo } from "../panels/SharePanel";
import { emptyTrip, newId, tripPoints, type ImportResult } from "../../shared/formats";
import { estimateFuel, formatRand } from "../../shared/fuel";
import { isInSouthAfrica } from "../../shared/southAfrica";
import { findTolls, totalTolls } from "../../shared/tolls";
import { distinguishingTowns } from "../../shared/towns";
import type { Attraction, AttractionCategory, Place, RouteAlternative, RoutePlan, Trip, Visibility } from "../../shared/types";
import { duration, km, storage } from "../format";

type Tab = "stops" | "directions" | "alternatives" | "costs" | "road" | "explore" | "share";
const TABS: Array<{ id: Tab; label: string; needsPlan?: boolean }> = [
  { id: "stops", label: "Stops" },
  { id: "directions", label: "Directions", needsPlan: true },
  { id: "alternatives", label: "Alternatives", needsPlan: true },
  { id: "costs", label: "Costs", needsPlan: true },
  { id: "road", label: "Road info", needsPlan: true },
  { id: "explore", label: "Explore", needsPlan: true },
  { id: "share", label: "Save & share" },
];

const DRAFT_KEY = "padkos:draft:v1";

interface Draft {
  trip: Trip;
  plan: RoutePlan | null;
  planSig: string | null;
  saved: SavedInfo | null;
}

/** Identifies the set and order of points a plan was computed for. */
function signature(t: Trip): string {
  return JSON.stringify([t.settings.roundTrip, ...tripPoints(t).map((p) => [p.lat.toFixed(6), p.lng.toFixed(6)])]);
}

const pt = (p: Place) => ({ lat: p.lat, lng: p.lng, name: p.name });

export function Planner() {
  const { toast, requireSignIn, user } = useApp();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const draft = useRef(storage.get<Draft>(DRAFT_KEY));

  const [trip, setTrip] = useState<Trip>(draft.current?.trip ?? emptyTrip());
  const [plan, setPlan] = useState<RoutePlan | null>(draft.current?.plan ?? null);
  const [planSig, setPlanSig] = useState<string | null>(draft.current?.planSig ?? null);
  const [saved, setSaved] = useState<SavedInfo | null>(draft.current?.saved ?? null);
  const [tab, setTab] = useState<Tab>("stops");
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedLeg, setSelectedLeg] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number; key: number } | null>(null);
  const [fitKey, setFitKey] = useState("init");

  const [altLeg, setAltLeg] = useState(0);
  const [alts, setAlts] = useState<{ leg: number; list: RouteAlternative[] | null; loading: boolean; error: string | null }>({
    leg: 0,
    list: null,
    loading: false,
    error: null,
  });
  const [issues, setIssues] = useState<IssuesState>({ loading: false, issues: null, errors: [], tomtom: false });
  const [explore, setExplore] = useState<ExploreState>(EMPTY_EXPLORE);
  const [categories, setCategories] = useState<AttractionCategory[]>(DEFAULT_CATEGORIES);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [addingAttraction, setAddingAttraction] = useState<string | null>(null);
  const exploreCtrl = useRef<AbortController | null>(null);

  const update = useCallback((fn: (t: Trip) => Trip) => setTrip((t) => fn(t)), []);
  const updateSettings = useCallback(
    (patch: Partial<Trip["settings"]>) => setTrip((t) => ({ ...t, settings: { ...t.settings, ...patch } })),
    [],
  );

  // persist a local draft so a refresh never loses work
  useEffect(() => {
    const t = setTimeout(() => storage.set(DRAFT_KEY, { trip, plan, planSig, saved } satisfies Draft), 400);
    return () => clearTimeout(t);
  }, [trip, plan, planSig, saved]);

  // open a saved route: /?route=<id>
  useEffect(() => {
    const id = params.get("route");
    if (!id) return;
    api
      .getRoute(id)
      .then((r) => {
        if (!r.isOwner) {
          navigate(`/r/${r.id}`, { replace: true });
          return;
        }
        resetDerived();
        setTrip(r.trip);
        setPlan(r.plan);
        setPlanSig(r.plan ? signature(r.trip) : null);
        setSaved({ id: r.id, visibility: r.visibility, shareToken: r.shareToken });
        setFitKey(`load-${r.id}-${Date.now()}`);
        setTab(r.plan ? "directions" : "stops");
        toast(`Opened "${r.trip.title}"`);
      })
      .catch((e) => toast(e.message, true))
      .finally(() => {
        params.delete("route");
        setParams(params, { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get("route"), user?.id]);

  const points = useMemo(() => tripPoints(trip), [trip]);
  const planCurrent = !!plan && planSig === signature(trip);
  const tolls = useMemo(() => (plan ? findTolls(plan.legs.map((l) => l.geometry), trip.tollOverrides) : []), [plan, trip.tollOverrides]);
  const fuel = plan ? estimateFuel(plan.distance, trip.settings.fuel) : null;

  /** Clear results that belong to the previous route. Attractions can be kept when the route only gained a stop. */
  function resetDerived(opts: { keepExplore?: boolean } = {}) {
    setAlts({ leg: 0, list: null, loading: false, error: null });
    setIssues({ loading: false, issues: null, errors: [], tomtom: false });
    if (!opts.keepExplore) {
      exploreCtrl.current?.abort();
      setExplore(EMPTY_EXPLORE);
    }
    setSelectedLeg(null);
    setAltLeg(0);
  }

  const runPlan = useCallback(
    async (opts: { trip?: Trip; optimize?: boolean; keepExplore?: boolean } = {}) => {
      const t = opts.trip ?? trip;
      if (!t.start) {
        setPlanError("Choose a starting point first.");
        return;
      }
      if (!t.settings.roundTrip && !t.end) {
        setPlanError("Choose a destination, or tick Round trip.");
        return;
      }
      setPlanning(true);
      setPlanError(null);
      try {
        const p = await api.plan({
          start: pt(t.start),
          end: t.settings.roundTrip ? null : pt(t.end!),
          stops: t.stops.map(pt),
          optimize: opts.optimize ?? t.settings.optimize,
          optimizeBy: t.settings.optimizeBy,
          roundTrip: t.settings.roundTrip,
        });
        const next = p.optimized ? { ...t, stops: p.order.map((i) => t.stops[i]) } : t;
        p.order = next.stops.map((_, i) => i);
        resetDerived({ keepExplore: opts.keepExplore });
        setTrip(next);
        setPlan(p);
        setPlanSig(signature(next));
        setFitKey(`plan-${p.computedAt}`);
        if (p.optimized && p.matrixSource === "straight-line")
          toast("The routing server was busy, so stops were ordered by straight-line distance.", true);
        else toast(p.optimized ? `Route planned — ${t.stops.length} stops put in the best order` : "Route planned");
      } catch (e) {
        setPlanError((e as Error).message);
      } finally {
        setPlanning(false);
      }
    },
    [trip, toast],
  );

  // ------------------------------------------------------------- map clicks
  const placeAt = useCallback(
    async (lat: number, lng: number): Promise<Place | null> => {
      if (!isInSouthAfrica(lat, lng)) {
        toast("Padkos only plans trips inside South Africa.", true);
        return null;
      }
      try {
        const r = await api.reverse(lat, lng);
        return { id: newId(), name: r.name, address: r.address, lat, lng, kind: "custom", city: r.city };
      } catch {
        return { id: newId(), name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng, kind: "custom" };
      }
    },
    [toast],
  );

  const clickActions: ClickAction[] = useMemo(
    () => [
      {
        label: trip.start ? "Add a stop here" : "Start here",
        primary: true,
        run: async (lat, lng) => {
          const p = await placeAt(lat, lng);
          if (!p) return;
          if (!trip.start) update((t) => ({ ...t, start: p }));
          else if (trip.stops.length >= MAX_STOPS) toast(`A trip can have at most ${MAX_STOPS} stops`, true);
          else update((t) => ({ ...t, stops: [...t.stops, p] }));
        },
      },
      ...(trip.start
        ? [
            {
              label: "Make this the start",
              run: async (lat: number, lng: number) => {
                const p = await placeAt(lat, lng);
                if (p) update((t) => ({ ...t, start: p }));
              },
            },
          ]
        : []),
      ...(!trip.settings.roundTrip
        ? [
            {
              label: "Make this the destination",
              run: async (lat: number, lng: number) => {
                const p = await placeAt(lat, lng);
                if (p) update((t) => ({ ...t, end: p }));
              },
            },
          ]
        : []),
    ],
    [trip.start, trip.stops.length, trip.settings.roundTrip, placeAt, update, toast],
  );

  // ------------------------------------------------------------- alternatives
  const fetchAlts = async () => {
    if (!plan) return;
    if (!planCurrent || !points[altLeg + 1]) {
      setAlts({ leg: altLeg, list: null, loading: false, error: "Your stops changed since the route was planned. Re-plan first, then compare alternatives." });
      return;
    }
    const leg = altLeg;
    setAlts({ leg, list: null, loading: true, error: null });
    try {
      const list = await api.alternatives(pt(points[leg]), pt(points[leg + 1]));
      setAlts({ leg, list, loading: false, error: null });
    } catch (e) {
      setAlts({ leg, list: null, loading: false, error: (e as Error).message });
    }
  };
  const chooseAlt = (i: number) => {
    if (!plan || !alts.list) return;
    const a = alts.list[i];
    const legs = plan.legs.map((l, k) => (k === alts.leg ? { ...a, alternative: i } : l));
    setPlan({ ...plan, legs, distance: legs.reduce((s, l) => s + l.distance, 0), duration: legs.reduce((s, l) => s + l.duration, 0) });
    setIssues({ loading: false, issues: null, errors: [], tomtom: false });
    toast(`Leg ${alts.leg + 1} now goes ${altVia[i] ? `via ${altVia[i]}` : a.summary ? `via ${a.summary}` : "the alternative way"}`);
  };
  const altVia = useMemo(() => (alts.list ? distinguishingTowns(alts.list.map((a) => a.geometry)) : []), [alts.list]);
  const mapAlts: MapAlternative[] =
    tab === "alternatives" && alts.list && plan
      ? alts.list.map((a, i) => ({
          geometry: a.geometry,
          label: `${altVia[i] ? `Via ${altVia[i]}` : a.summary || `Route ${i + 1}`}: ${km(a.distance)}, ${duration(a.duration)}`,
          selected: a.geometry === plan.legs[alts.leg]?.geometry,
          onPick: () => chooseAlt(i),
        }))
      : [];

  // ------------------------------------------------------------- road works
  const loadIssues = async () => {
    if (!plan) return;
    setIssues((s) => ({ ...s, loading: true, errors: [] }));
    try {
      const r = await api.roadworks(plan.legs.map((l) => l.geometry));
      setIssues({ loading: false, issues: r.issues, errors: r.errors, tomtom: r.sources.tomtom });
    } catch (e) {
      setIssues({ loading: false, issues: null, errors: [(e as Error).message], tomtom: false });
    }
  };
  useEffect(() => {
    if (tab === "road" && plan && planCurrent && !issues.issues && !issues.loading && !issues.errors.length) loadIssues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, plan]);

  // ------------------------------------------------------------- explore
  /** Search along the route; with `retry`, search only those sections again using the original settings. */
  const searchAttractions = async (retry?: number[]) => {
    if (!plan) return;
    exploreCtrl.current?.abort();
    const c = new AbortController();
    exploreCtrl.current = c;
    const params = retry && explore.params ? explore.params : { radiusKm: trip.settings.attractionRadiusKm, categories: [...categories] };
    const key = `${params.radiusKm}|${[...params.categories].sort().join(",")}`;
    if (retry)
      setExplore((s) => ({ ...s, loading: true, error: undefined, dropped: undefined, stopped: false, failed: s.failed.filter((i) => !retry.includes(i)), pending: retry }));
    else setExplore({ ...EMPTY_EXPLORE, loading: true, list: [], key, params });

    let pending: number[] = retry ?? [];
    try {
      await api.attractionsStream(
        { legs: plan.legs.map((l) => l.geometry), radiusKm: params.radiusKm, categories: params.categories, sections: retry },
        (e) => {
          if (c.signal.aborted) return;
          if (e.type === "start") {
            pending = e.sections;
            setExplore((s) => ({ ...s, total: e.total, pending: e.sections }));
          } else if (e.type === "retrying") {
            pending = e.sections;
            setExplore((s) => ({ ...s, failed: s.failed.filter((i) => !e.sections.includes(i)), pending: e.sections, retrying: true }));
          } else if (e.type === "section") {
            pending = pending.filter((i) => i !== e.index);
            setExplore((s) => {
              const seen = new Set((s.list ?? []).map((a) => a.id));
              const merged = [...(s.list ?? []), ...e.attractions.filter((a) => !seen.has(a.id))].sort((x, y) => y.popularity - x.popularity);
              return {
                ...s,
                list: merged,
                done: [...s.done, e.index],
                failed: s.failed.filter((i) => i !== e.index),
                pending: s.pending.filter((i) => i !== e.index),
              };
            });
          } else if (e.type === "section-error") {
            pending = pending.filter((i) => i !== e.index);
            setExplore((s) => ({ ...s, failed: [...s.failed, e.index], pending: s.pending.filter((i) => i !== e.index) }));
          }
        },
        c.signal,
      );
      setExplore((s) => ({ ...s, loading: false, retrying: false }));
    } catch (err) {
      if ((err as Error).name === "AbortError" || c.signal.aborted) return;
      // whatever was still outstanding counts as failed, so "Retry" picks it up
      const lost = pending;
      setExplore((s) => ({
        ...s,
        loading: false,
        retrying: false,
        failed: [...new Set([...s.failed, ...lost])].sort((x, y) => x - y),
        pending: [],
        error: s.total ? undefined : (err as Error).message,
        dropped: s.total ? (err as Error).message : undefined,
      }));
    }
  };

  const stopAttractions = () => {
    exploreCtrl.current?.abort();
    setExplore((s) => ({
      ...s,
      loading: false,
      failed: [...new Set([...s.failed, ...s.pending])].sort((x, y) => x - y),
      pending: [],
      stopped: true,
    }));
  };

  const addedIds = useMemo(() => new Set(trip.stops.map((s) => s.id)), [trip.stops]);

  const addAttraction = async (a: Attraction) => {
    if (!trip.start || !plan) return;
    if (trip.stops.length >= MAX_STOPS) {
      toast(`A trip can have at most ${MAX_STOPS} stops`, true);
      return;
    }
    setAddingAttraction(a.id);
    const stop: Place = { id: a.id, name: a.name, lat: a.lat, lng: a.lng, kind: "attraction", stayMinutes: a.category === "fuel" ? 15 : 60 };
    try {
      const end = trip.settings.roundTrip ? trip.start : trip.end!;
      let index = trip.stops.length;
      try {
        index = await api.insertion({
          start: pt(trip.start),
          end: pt(end),
          stops: trip.stops.map(pt),
          point: pt(stop),
          legDurations: planCurrent ? plan.legs.map((l) => l.duration) : undefined,
        });
      } catch {
        // fall back to appending
      }
      const next = { ...trip, stops: [...trip.stops.slice(0, index), stop, ...trip.stops.slice(index)] };
      toast(`Added ${a.name} as stop ${index + 1}`);
      // the route only gains a detour, so the places found along it are still relevant
      await runPlan({ trip: next, optimize: false, keepExplore: true });
    } finally {
      setAddingAttraction(null);
    }
  };

  // ------------------------------------------------------------- saving
  const save = async (visibility: Visibility) => {
    const u = await requireSignIn("Sign in to save trips, share them and vote on community routes.");
    if (!u) return;
    setSaving(true);
    try {
      const planToSave = planCurrent ? plan : null;
      const r = saved
        ? await api.updateRoute(saved.id, { trip, plan: planToSave, visibility })
        : await api.createRoute(trip, planToSave, visibility);
      setSaved({ id: r.id, visibility: r.visibility, shareToken: r.shareToken });
      toast(saved ? "Changes saved" : visibility === "public" ? "Saved and published to Community routes" : "Trip saved");
    } catch (e) {
      if ((e as { status?: number }).status === 404 && saved) {
        // the saved route was deleted elsewhere: save as new
        setSaved(null);
        toast("That saved trip no longer exists — press Save again to save a new copy.", true);
      } else toast((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  };

  const rotateToken = async () => {
    if (!saved) return;
    try {
      const shareToken = await api.rotateShareToken(saved.id);
      setSaved({ ...saved, shareToken });
      toast("New link created. The old link no longer works.");
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const onImport = (r: ImportResult) => {
    resetDerived();
    setTrip(r.trip);
    setPlan(r.plan);
    setPlanSig(r.plan ? signature(r.trip) : null);
    setSaved(null);
    setFitKey(`import-${Date.now()}`);
  };

  const newTrip = () => {
    if (!confirm("Start a new trip? Unsaved changes to this one will be lost.")) return;
    resetDerived();
    setTrip(emptyTrip());
    setPlan(null);
    setPlanSig(null);
    setSaved(null);
    setTab("stops");
  };

  const focusOn = (lat: number, lng: number, zoom?: number) => setFocus({ lat, lng, zoom, key: Date.now() });

  const tollTotal = totalTolls(tolls);

  return (
    <main className="planner">
      <section className="panel" aria-label="Trip planner">
        <div className="panel-head">
          <label className="visually-hidden" htmlFor="trip-title">
            Trip name
          </label>
          <input
            id="trip-title"
            className="title-input"
            value={trip.title}
            maxLength={120}
            onChange={(e) => update((t) => ({ ...t, title: e.target.value }))}
            onBlur={(e) => !e.target.value.trim() && update((t) => ({ ...t, title: "Untitled road trip" }))}
          />
          <div className="small muted">
            {saved ? (saved.visibility === "private" ? "Saved privately" : saved.visibility === "public" ? "Saved and public" : "Saved, shared by link") : "Not saved yet"}
          </div>
        </div>
        <div className="tabs" role="tablist" aria-label="Planner sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              disabled={t.needsPlan && !plan}
              title={t.needsPlan && !plan ? "Plan the route first" : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === "stops" && trip.stops.length > 0 && <span className="badge">{trip.stops.length}</span>}
              {t.id === "road" && issues.issues && issues.issues.length > 0 && <span className="badge">{issues.issues.length}</span>}
            </button>
          ))}
        </div>

        <div className="panel-body" role="tabpanel">
          {tab === "stops" && (
            <StopsPanel
              trip={trip}
              update={update}
              onPlan={() => runPlan()}
              planning={planning}
              hasPlan={!!plan}
              planCurrent={planCurrent}
              error={planError}
              toast={toast}
            />
          )}
          {tab === "directions" && plan && (
            <DirectionsPanel
              trip={trip}
              plan={plan}
              points={points}
              tolls={tolls}
              selectedLeg={selectedLeg}
              onSelectLeg={setSelectedLeg}
              onFocus={(lat, lng) => focusOn(lat, lng, 15)}
              updateSettings={updateSettings}
              updatePoint={(pointIndex, patch) =>
                // intermediate points are the stops; index 0 is the start
                update((t) => ({ ...t, stops: t.stops.map((p, k) => (k === pointIndex - 1 ? { ...p, ...patch } : p)) }))
              }
            />
          )}
          {tab === "alternatives" && plan && (
            <AlternativesPanel
              plan={plan}
              points={points}
              leg={Math.min(altLeg, plan.legs.length - 1)}
              setLeg={(i) => {
                setAltLeg(i);
                setSelectedLeg(i);
                setAlts({ leg: i, list: null, loading: false, error: null });
              }}
              alternatives={alts.leg === altLeg ? alts.list : null}
              loading={alts.loading}
              error={alts.error}
              onFetch={fetchAlts}
              onChoose={chooseAlt}
              tollOverrides={trip.tollOverrides}
            />
          )}
          {tab === "costs" && plan && (
            <CostsPanel
              distance={plan.distance}
              fuel={trip.settings.fuel}
              passengers={trip.settings.passengers}
              tolls={tolls}
              onFuel={(patch) => updateSettings({ fuel: { ...trip.settings.fuel, ...patch } })}
              onPassengers={(passengers) => updateSettings({ passengers })}
              onTollFee={(id, fee) =>
                update((t) => {
                  const o = { ...(t.tollOverrides ?? {}) };
                  if (fee == null) delete o[id];
                  else o[id] = fee;
                  return { ...t, tollOverrides: o };
                })
              }
            />
          )}
          {tab === "road" && plan && <RoadPanel tolls={tolls} issues={issues} onLoad={loadIssues} onFocus={(lat, lng) => focusOn(lat, lng, 14)} />}
          {tab === "explore" && plan && (
            <ExplorePanel
              radiusKm={trip.settings.attractionRadiusKm}
              setRadius={(attractionRadiusKm) => updateSettings({ attractionRadiusKm })}
              categories={categories}
              setCategories={setCategories}
              state={explore}
              onSearch={() => searchAttractions()}
              onRetry={() => searchAttractions(explore.failed)}
              onStop={stopAttractions}
              onAdd={addAttraction}
              onFocus={(a) => {
                setHighlight(a.id);
                focusOn(a.lat, a.lng, 13);
              }}
              addedIds={addedIds}
              adding={addingAttraction}
            />
          )}
          {tab === "share" && (
            <SharePanel
              key={`${saved?.id}-${saved?.visibility}`}
              trip={trip}
              plan={planCurrent ? plan : null}
              points={points}
              update={update}
              saved={saved}
              onSave={save}
              onRotateToken={rotateToken}
              onImport={onImport}
              onNew={newTrip}
              saving={saving}
              toast={toast}
            />
          )}
        </div>

        {plan && !planCurrent && (
          <div className="stale" role="status">
            <span>Stops changed since the route was planned.</span>
            <button className="btn small primary" onClick={() => runPlan()} disabled={planning}>
              {planning ? <span className="spinner" /> : "Re-plan"}
            </button>
          </div>
        )}
        {plan && (
          <div className="summary" aria-label="Trip summary">
            <div>
              <strong>{km(plan.distance)}</strong>
              <span>distance</span>
            </div>
            <div>
              <strong>{duration(plan.duration)}</strong>
              <span>driving</span>
            </div>
            <div>
              <strong>{fuel ? formatRand(fuel.cost) : "–"}</strong>
              <span>fuel</span>
            </div>
            <div>
              <strong>{formatRand(tollTotal)}</strong>
              <span>
                {tolls.length} toll{tolls.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        )}
      </section>

      <div className="map-wrap">
        <MapView
          points={points}
          roundTrip={trip.settings.roundTrip}
          legs={plan?.legs ?? []}
          selectedLeg={selectedLeg}
          onSelectLeg={(i) => {
            setSelectedLeg(i);
            setAltLeg(i);
          }}
          alternatives={mapAlts}
          attractions={
            tab === "explore"
              ? (explore.list ?? [])
                  .filter((a) => categories.includes(a.category) && a.distanceFromRoute <= trip.settings.attractionRadiusKm * 1000)
                  .slice(0, 150)
              : []
          }
          onAddAttraction={addAttraction}
          highlightAttraction={highlight}
          tolls={tab === "road" || tab === "costs" ? tolls : []}
          issues={issues.issues ?? []}
          clickActions={clickActions}
          focus={focus}
          fitKey={fitKey}
          hint={!trip.start ? "Click the map to drop a starting point, or search on the left" : undefined}
        />
      </div>
    </main>
  );
}
