import { useState } from "react";
import { api, type GeoResult } from "../api";
import { PlaceSearch } from "../components/PlaceSearch";
import { newId } from "../../shared/formats";
import type { Place, Trip } from "../../shared/types";

export const MAX_STOPS = 100;

export function placeFromResult(r: GeoResult): Place {
  return { id: newId(), name: r.name, address: r.address || undefined, lat: r.lat, lng: r.lng, kind: r.kind, city: r.city };
}

interface Props {
  trip: Trip;
  update: (fn: (t: Trip) => Trip) => void;
  onPlan: () => void;
  planning: boolean;
  hasPlan: boolean;
  planCurrent: boolean;
  error: string | null;
  toast: (t: string, err?: boolean) => void;
}

function EndpointField({
  label,
  place,
  onChange,
  plateClass,
  plateText,
  near,
}: {
  label: string;
  place: Place | null;
  onChange: (p: Place | null) => void;
  plateClass: string;
  plateText: string;
  near?: { lat: number; lng: number };
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="stop" style={{ borderBottom: 0, paddingBottom: 2 }}>
      <span className={`plate ${plateClass}`}>{plateText}</span>
      <div className="grow">
        {place && !editing ? (
          <>
            <div className="stop-name">{place.name}</div>
            {place.address && <div className="stop-meta">{place.address}</div>}
          </>
        ) : (
          <PlaceSearch label={label} placeholder={label} onPick={(r) => (onChange(placeFromResult(r)), setEditing(false))} near={near} autoFocus={editing} />
        )}
      </div>
      <div className="stop-actions">
        {place && !editing && (
          <>
            <button className="icon-btn" title={`Change ${label.toLowerCase()}`} aria-label={`Change ${label.toLowerCase()}`} onClick={() => setEditing(true)}>
              ✎
            </button>
            <button className="icon-btn" title="Clear" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onChange(null)}>
              ✕
            </button>
          </>
        )}
        {editing && (
          <button className="icon-btn" aria-label="Cancel" onClick={() => setEditing(false)}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

export function StopsPanel({ trip, update, onPlan, planning, hasPlan, planCurrent, error, toast }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  const s = trip.settings;
  const near = trip.stops.at(-1) ?? trip.start ?? undefined;

  const setSettings = (patch: Partial<Trip["settings"]>) => update((t) => ({ ...t, settings: { ...t.settings, ...patch } }));
  const setStop = (id: string, patch: Partial<Place>) =>
    update((t) => ({ ...t, stops: t.stops.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  const move = (from: number, to: number) =>
    update((t) => {
      if (to < 0 || to >= t.stops.length || from === to) return t;
      const stops = [...t.stops];
      const [x] = stops.splice(from, 1);
      stops.splice(to, 0, x);
      // a manual order means the user wants this order kept
      return { ...t, stops, settings: { ...t.settings, optimize: false } };
    });

  const addStop = (p: Place) => {
    if (trip.stops.length >= MAX_STOPS) {
      toast(`A trip can have at most ${MAX_STOPS} stops`, true);
      return;
    }
    update((t) => ({ ...t, stops: [...t.stops, p] }));
  };

  const runBulk = async () => {
    const lines = bulkText
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const room = MAX_STOPS - trip.stops.length;
    if (lines.length > room) toast(`Only the first ${room} places fit — a trip can have ${MAX_STOPS} stops`, true);
    const missing: string[] = [];
    const found: Place[] = [];
    for (const [i, line] of lines.slice(0, room).entries()) {
      setBulkProgress(`Looking up ${i + 1} of ${Math.min(lines.length, room)}: ${line}`);
      try {
        const r = await api.search(line, found.at(-1) ?? near);
        if (r[0]) found.push({ ...placeFromResult(r[0]), name: r[0].name });
        else missing.push(line);
      } catch {
        missing.push(line);
      }
    }
    update((t) => ({ ...t, stops: [...t.stops, ...found] }));
    setBulkProgress(null);
    setBulkText(missing.join("\n"));
    toast(missing.length ? `Added ${found.length} stops. ${missing.length} not found — they're left in the box to fix.` : `Added ${found.length} stops`, !!missing.length);
    if (!missing.length) setBulkOpen(false);
  };

  return (
    <>
      <div className="section">
        <EndpointField
          label="Starting point"
          place={trip.start}
          onChange={(p) => update((t) => ({ ...t, start: p }))}
          plateClass="start"
          plateText="A"
        />

        <ol className="stops" aria-label="Stops">
          {trip.stops.map((p, i) => (
            <li
              key={p.id}
              className={`stop${dragIndex === i ? " dragging" : ""}${overIndex === i && dragIndex !== null && dragIndex !== i ? " drop-target" : ""}`}
              draggable
              onDragStart={(e) => {
                setDragIndex(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIndex(i);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) move(dragIndex, i);
                setDragIndex(null);
                setOverIndex(null);
              }}
            >
              <span className="plate drag-handle" title="Drag to reorder">
                {i + 1}
              </span>
              <div>
                <div className="stop-name">{p.name}</div>
                <div className="stop-meta">
                  {[p.address, p.stayMinutes ? `stay ${p.stayMinutes} min` : null, p.overnight ? (p.nights && p.nights > 1 ? `${p.nights} nights here` : "overnight here") : null, p.private ? "hidden when shared" : null].filter(Boolean).join(" ∙ ")}
                </div>
              </div>
              <div className="stop-actions">
                <button className="icon-btn" aria-label={`Move ${p.name} up`} title="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>
                  ↑
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Move ${p.name} down`}
                  title="Move down"
                  disabled={i === trip.stops.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  ↓
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Details for ${p.name}`}
                  aria-expanded={expanded === p.id}
                  title="Stay time, privacy and notes"
                  onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                >
                  ⋯
                </button>
                <button className="icon-btn" aria-label={`Remove ${p.name}`} title="Remove" onClick={() => update((t) => ({ ...t, stops: t.stops.filter((x) => x.id !== p.id) }))}>
                  ✕
                </button>
              </div>
              {expanded === p.id && (
                <div className="stop-extra">
                  <div className="grid-2">
                    <label className="field">
                      Stay (minutes)
                      <input
                        className="input"
                        type="number"
                        min={0}
                        step={15}
                        value={p.stayMinutes ?? ""}
                        onChange={(e) => setStop(p.id, { stayMinutes: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)) })}
                      />
                    </label>
                    <label className="field">
                      Name
                      <input className="input" value={p.name} onChange={(e) => setStop(p.id, { name: e.target.value })} />
                    </label>
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={!!p.private} onChange={(e) => setStop(p.id, { private: e.target.checked })} />
                    Show only the town when this route is shared
                  </label>
                  <label className="field">
                    Notes (never shared)
                    <textarea className="input" value={p.notes ?? ""} maxLength={2000} onChange={(e) => setStop(p.id, { notes: e.target.value || undefined })} />
                  </label>
                </div>
              )}
            </li>
          ))}
        </ol>

        <div className="stop" style={{ borderBottom: 0 }}>
          <span className="plate" style={{ background: "#fff", color: "var(--asphalt)" }}>
            +
          </span>
          <PlaceSearch
            label="Add a stop"
            placeholder={trip.stops.length ? "Add another stop" : "Add a stop (town, address or attraction)"}
            onPick={(r) => addStop(placeFromResult(r))}
            near={near ? { lat: near.lat, lng: near.lng } : undefined}
          />
          <span />
        </div>

        {!s.roundTrip && (
          <EndpointField
            label="Destination"
            place={trip.end}
            onChange={(p) => update((t) => ({ ...t, end: p }))}
            plateClass="end"
            plateText="B"
            near={trip.start ? { lat: trip.start.lat, lng: trip.start.lng } : undefined}
          />
        )}

        <div className="row wrap small muted" style={{ justifyContent: "space-between" }}>
          <span className="num">
            {trip.stops.length} of {MAX_STOPS} stops
          </span>
          <span className="row">
            <button className="btn ghost small" onClick={() => setBulkOpen(!bulkOpen)} aria-expanded={bulkOpen}>
              Paste a list
            </button>
            {trip.stops.length > 0 && (
              <button
                className="btn ghost small danger"
                onClick={() => {
                  if (confirm(`Remove all ${trip.stops.length} stops?`)) update((t) => ({ ...t, stops: [] }));
                }}
              >
                Clear stops
              </button>
            )}
          </span>
        </div>
        {bulkOpen && (
          <div className="section" style={{ gap: 8 }}>
            <label className="field">
              One place per line — each is looked up and added in order
              <textarea
                className="input"
                rows={6}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={"Matjiesfontein\nOudtshoorn\nCango Caves\nKnysna Heads"}
              />
            </label>
            <div className="row">
              <button className="btn primary" disabled={!bulkText.trim() || !!bulkProgress} onClick={runBulk}>
                {bulkProgress ? <span className="spinner" /> : null} Add these places
              </button>
              {bulkProgress && <span className="small muted grow">{bulkProgress}</span>}
            </div>
          </div>
        )}
      </div>

      <div className="section">
        <div className="row wrap" style={{ gap: 14 }}>
          <label className="check">
            <input type="checkbox" checked={s.roundTrip} onChange={(e) => setSettings({ roundTrip: e.target.checked })} />
            Round trip back to the start
          </label>
          <label className="check">
            <input type="checkbox" checked={s.optimize} onChange={(e) => setSettings({ optimize: e.target.checked })} />
            Find the best stop order
          </label>
        </div>
        {s.optimize && (
          <div className="row small">
            <span className="muted">Optimise for</span>
            <div className="segmented" role="group" aria-label="Optimise for">
              <button aria-pressed={s.optimizeBy === "duration"} onClick={() => setSettings({ optimizeBy: "duration" })}>
                Shortest time
              </button>
              <button aria-pressed={s.optimizeBy === "distance"} onClick={() => setSettings({ optimizeBy: "distance" })}>
                Shortest distance
              </button>
            </div>
          </div>
        )}
        {error && <div className="notice error">{error}</div>}
        <button className="btn go" onClick={onPlan} disabled={planning || !trip.start || (!s.roundTrip && !trip.end)}>
          {planning ? (
            <>
              <span className="spinner" /> {trip.stops.length > 20 && s.optimize ? `Optimising ${trip.stops.length} stops…` : "Planning…"}
            </>
          ) : hasPlan && planCurrent ? (
            "Re-plan route"
          ) : (
            "Plan route"
          )}
        </button>
        {!trip.start && <p className="small muted">Search for a starting point, or click the map to drop one.</p>}
      </div>
    </>
  );
}
