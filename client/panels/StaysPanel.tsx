import { useState } from "react";
import { newId } from "../../shared/formats";
import { formatRand } from "../../shared/fuel";
import {
  BOOKING_SITE_LABELS,
  bookingSiteUrl,
  formatRandRange,
  MAX_SAVED_STAYS,
  nightlyRange,
  normaliseUrl,
  STAY_KIND_LABELS,
  townOf,
  type AffiliateIds,
  type BookingSite,
  type Overnight,
  type StayBudget,
} from "../../shared/stays";
import type { Place, SavedStay, StayOption } from "../../shared/types";
import { dayLabel, distanceShort } from "../format";

export interface StaySearchState {
  loading: boolean;
  list?: StayOption[];
  error?: string;
  radiusKm?: number;
}

export const STAY_RADII = [5, 10, 20, 30];

interface Props {
  overnights: Overnight[];
  budget: StayBudget;
  /** stops with saved stays where the trip no longer sleeps */
  orphaned: Place[];
  destination: Place | null;
  passengers: number;
  affiliates: AffiliateIds;
  radiusKm: number;
  setRadius: (km: number) => void;
  results: Record<string, StaySearchState>;
  onSearch: (placeIds?: string[]) => void;
  setStays: (placeId: string, fn: (stays: SavedStay[]) => SavedStay[]) => void;
  setDestinationNights: (n: number | undefined) => void;
  onSleepHere: (placeId: string) => void;
  active: string | null;
  setActive: (placeId: string | null) => void;
  onFocus: (lat: number, lng: number) => void;
  /** the stops changed since the route was planned */
  stale: boolean;
}

const day = (ymd: string) => dayLabel(new Date(`${ymd}T12:00`));
const SITES: BookingSite[] = ["booking", "airbnb", "agoda"];

export function savedFromOption(o: StayOption): SavedStay {
  return { id: o.id, name: o.name, lat: o.lat, lng: o.lng, kind: o.kind, url: normaliseUrl(o.website) };
}

function SavedRow({ stay, nights, onChange, onRemove }: { stay: SavedStay; nights: number; onChange: (patch: Partial<SavedStay>) => void; onRemove: () => void }) {
  const url = normaliseUrl(stay.url);
  return (
    <li className={`saved-stay${stay.chosen ? " chosen" : ""}`}>
      <button
        className="pick"
        aria-pressed={!!stay.chosen}
        title={stay.chosen ? "Picked: the budget uses this price alone" : "Pick this one"}
        onClick={() => onChange({ chosen: !stay.chosen })}
      >
        {stay.chosen ? "✓" : ""}
        <span className="visually-hidden">{stay.chosen ? `Unpick ${stay.name}` : `Pick ${stay.name}`}</span>
      </button>
      <span className="grow" style={{ minWidth: 0 }}>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="item-title">
            {stay.name}
          </a>
        ) : (
          <span className="item-title">{stay.name}</span>
        )}
        <span className="small muted" style={{ display: "block" }}>
          {stay.kind ? STAY_KIND_LABELS[stay.kind] : "Your own"}
          {stay.price != null && nights > 1 ? ` ∙ ${formatRand(stay.price * nights)} for ${nights} nights` : ""}
        </span>
      </span>
      <label className="price">
        <span className="visually-hidden">Price per night for {stay.name}, in rand</span>
        <span aria-hidden="true">R</span>
        <input
          className="input fee-input num"
          type="number"
          min={0}
          step={50}
          placeholder="per night"
          value={stay.price ?? ""}
          onChange={(e) => onChange({ price: e.target.value === "" ? undefined : Math.min(1_000_000, Math.max(0, Number(e.target.value))) })}
        />
      </label>
      <button className="icon-btn" onClick={onRemove} aria-label={`Remove ${stay.name}`} title="Remove">
        ×
      </button>
    </li>
  );
}

function AddOwn({ onAdd }: { onAdd: (s: SavedStay) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [link, setLink] = useState("");
  const url = normaliseUrl(link);
  const badLink = link.trim() !== "" && !url;
  if (!open)
    return (
      <button className="btn small ghost" onClick={() => setOpen(true)}>
        + Add a place you found elsewhere
      </button>
    );
  return (
    <form
      className="add-own"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || badLink) return;
        onAdd({ id: newId(), name: name.trim(), price: price === "" ? undefined : Math.max(0, Number(price)), url });
        setName("");
        setPrice("");
        setLink("");
        setOpen(false);
      }}
    >
      <input className="input" placeholder="Name" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" autoFocus />
      <div className="grid-2">
        <input className="input" type="number" min={0} step={50} placeholder="R per night" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Price per night in rand" />
        <input className="input" placeholder="Link (optional)" value={link} onChange={(e) => setLink(e.target.value)} aria-label="Link to the listing" aria-invalid={badLink} />
      </div>
      {badLink && <span className="small" style={{ color: "var(--red)" }}>Use a web link (https://…)</span>}
      <div className="row">
        <button className="btn small primary" type="submit" disabled={!name.trim() || badLink}>
          Save
        </button>
        <button className="btn small" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function OvernightCard({
  o,
  index,
  passengers,
  affiliates,
  search,
  onSearch,
  setStays,
  active,
  onActivate,
  onFocus,
}: {
  o: Overnight;
  index: number;
  passengers: number;
  affiliates: AffiliateIds;
  search?: StaySearchState;
  onSearch: () => void;
  setStays: (fn: (stays: SavedStay[]) => SavedStay[]) => void;
  active: boolean;
  onActivate: () => void;
  onFocus: (lat: number, lng: number) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const saved = o.place.stays ?? [];
  const savedIds = new Set(saved.map((s) => s.id));
  const range = nightlyRange(saved);
  const full = saved.length >= MAX_SAVED_STAYS;
  const town = townOf(o.place);
  const q = { checkIn: o.checkIn, checkOut: o.checkOut, adults: passengers };
  const found = search?.list ?? [];
  const shown = showAll ? found : found.slice(0, 6);

  const save = (s: SavedStay) => setStays((list) => (list.some((x) => x.id === s.id) || list.length >= MAX_SAVED_STAYS ? list : [...list, s]));
  const change = (id: string, patch: Partial<SavedStay>) =>
    setStays((list) =>
      list.map((s) =>
        s.id === id ? { ...s, ...patch } : patch.chosen ? { ...s, chosen: undefined } : s, // only one pick per night
      ),
    );

  return (
    <div className={`stay-card${active ? " active" : ""}`} onFocusCapture={onActivate} onMouseDown={onActivate}>
      <div className="stop-row-head">
        <span className={`plate${o.destination ? " end" : ""}`}>{o.destination ? "B" : index}</span>
        <span className="grow">
          <button className="btn ghost small link-title" onClick={() => onFocus(o.place.lat, o.place.lng)}>
            <strong>{o.place.name}</strong>
          </button>
          <span className="small muted" style={{ display: "block" }}>
            {day(o.checkIn)} → {day(o.checkOut)} ∙ {o.nights} night{o.nights > 1 ? "s" : ""}
            {o.auto ? " (overnight chosen automatically)" : ""}
            {o.destination ? " at the destination" : ""}
          </span>
        </span>
        <span className="small num" style={{ textAlign: "right" }}>
          {range ? formatRandRange(range.min * o.nights, range.max * o.nights) : <span className="muted">not priced</span>}
        </span>
      </div>

      <div className="small row wrap stay-links">
        <span className="muted">Search {town} on</span>
        {SITES.map((site) => (
          <a key={site} href={bookingSiteUrl(site, { ...q, query: `${town}, South Africa` }, affiliates)} target="_blank" rel="noreferrer">
            {BOOKING_SITE_LABELS[site]}
          </a>
        ))}
      </div>

      {saved.length > 0 && (
        <ul className="list saved-stays" aria-label={`Saved places to stay at ${o.place.name}`}>
          {saved.map((s) => (
            <SavedRow
              key={s.id}
              stay={s}
              nights={o.nights}
              onChange={(patch) => change(s.id, patch)}
              onRemove={() => setStays((list) => list.filter((x) => x.id !== s.id))}
            />
          ))}
        </ul>
      )}
      {saved.length > 0 && !range && <p className="small muted" style={{ margin: 0 }}>Type a nightly price on a saved place to include this stop in the budget.</p>}
      {full ? <p className="small muted" style={{ margin: 0 }}>You can save up to {MAX_SAVED_STAYS} places per stop.</p> : <AddOwn onAdd={save} />}

      {search?.loading && (
        <p className="small muted row" style={{ margin: 0 }}>
          <span className="spinner" /> Looking for places to stay…
        </p>
      )}
      {search?.error && (
        <div className="notice row wrap" style={{ justifyContent: "space-between" }}>
          <span>{search.error}</span>
          <button className="btn small" onClick={onSearch}>
            Try again
          </button>
        </div>
      )}
      {search?.list && (
        <div className="found">
          <div className="small muted">
            {found.length === 0
              ? `Nothing listed on OpenStreetMap within ${search.radiusKm} km. Try a wider radius or the booking sites.`
              : `${found.length} place${found.length === 1 ? "" : "s"} within ${search.radiusKm} km on OpenStreetMap`}
          </div>
          <ul className="list">
            {shown.map((s) => {
              const site = normaliseUrl(s.website);
              return (
                <li key={s.id}>
                  <div className="item">
                    <span className="stay-pin" aria-hidden="true">
                      ⌂
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <button className="btn ghost small link-title" onClick={() => onFocus(s.lat, s.lng)}>
                        <span className="item-title">{s.name}</span>
                      </button>
                      <div className="small muted">
                        {STAY_KIND_LABELS[s.kind]}
                        {s.stars ? ` ∙ ${"★".repeat(Math.round(s.stars))}` : ""} ∙ {distanceShort(s.distance)} away
                        {s.town && s.town !== town ? ` ∙ ${s.town}` : ""}
                      </div>
                      <div className="small row wrap" style={{ gap: 10 }}>
                        {site && (
                          <a href={site} target="_blank" rel="noreferrer">
                            Website
                          </a>
                        )}
                        <a href={bookingSiteUrl("booking", { ...q, query: `${s.name}, ${s.town ?? town}` }, affiliates)} target="_blank" rel="noreferrer">
                          Prices on Booking.com
                        </a>
                      </div>
                    </div>
                    <button className="btn small" onClick={() => save(savedFromOption(s))} disabled={savedIds.has(s.id) || full}>
                      {savedIds.has(s.id) ? "Saved" : "Save"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {found.length > shown.length && (
            <button className="btn small ghost" onClick={() => setShowAll(true)}>
              Show all {found.length}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function StaysPanel(props: Props) {
  const { overnights, budget, destination, results } = props;
  const searching = overnights.some((o) => results[o.place.id]?.loading);
  const searched = overnights.some((o) => results[o.place.id]?.list);

  return (
    <>
      <div className="section">
        <div className="section-head">
          <h3>Where you'll sleep</h3>
          <span className="small muted">
            {budget.nights} night{budget.nights === 1 ? "" : "s"} away
          </span>
        </div>
        {props.stale && <div className="notice">Your stops changed. Re-plan to update the overnight stops and dates.</div>}
        {budget.nights > 0 && (
          <p style={{ margin: 0 }}>
            Accommodation:{" "}
            <strong>{budget.budgetedNights > 0 ? formatRandRange(budget.min, budget.max) : "not priced yet"}</strong>
            {budget.unbudgeted.length > 0 && budget.budgetedNights > 0 && (
              <span className="small muted">
                {" "}
                for {budget.budgetedNights} of {budget.nights} nights
              </span>
            )}
          </p>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          Save the places you're considering at each stop and type in their price per night for your whole group. The budget runs from the cheapest
          to the dearest saved place at every stop; tick one to use its price alone.
        </p>
        {destination && (
          <label className="row small">
            Nights at {destination.name}
            <input
              className="input fee-input num"
              style={{ width: 64 }}
              type="number"
              min={0}
              max={30}
              value={destination.nights ?? 0}
              onChange={(e) => {
                const n = Math.min(30, Math.max(0, Math.round(Number(e.target.value)) || 0));
                props.setDestinationNights(n || undefined);
              }}
            />
          </label>
        )}
        {overnights.length === 0 ? (
          <p className="small" style={{ margin: 0 }}>
            This trip has no nights away. Choose "Sleep here" at a stop on the Directions tab{destination ? ", or add nights at the destination above" : ""}.
          </p>
        ) : (
          <>
            <div className="row wrap small">
              <span className="muted">Search within</span>
              <div className="segmented" role="group" aria-label="Search radius around each stop">
                {STAY_RADII.map((r) => (
                  <button key={r} aria-pressed={props.radiusKm === r} onClick={() => props.setRadius(r)}>
                    {r} km
                  </button>
                ))}
              </div>
            </div>
            <button className="btn primary" onClick={() => props.onSearch()} disabled={searching || props.stale}>
              {searching ? <span className="spinner" /> : searched ? "Search again" : "Find places to stay"}
            </button>
          </>
        )}
        {props.orphaned.length > 0 && (
          <div className="notice">
            You saved places to stay at stops where the trip no longer sleeps:{" "}
            {props.orphaned.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ", "}
                {p.name} ({p.stays!.length}){" "}
                <button className="btn small ghost" style={{ minHeight: 0, padding: "0 4px" }} onClick={() => props.onSleepHere(p.id)}>
                  Sleep here
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {overnights.map((o) => (
        <div className="section" key={`${o.place.id}-${o.pointIndex}`}>
          <OvernightCard
            o={o}
            index={o.pointIndex}
            passengers={props.passengers}
            affiliates={props.affiliates}
            search={results[o.place.id]}
            onSearch={() => props.onSearch([o.place.id])}
            setStays={(fn) => props.setStays(o.place.id, fn)}
            active={props.active === o.place.id}
            onActivate={() => props.setActive(o.place.id)}
            onFocus={props.onFocus}
          />
        </div>
      ))}

      {overnights.length > 0 && (
        <p className="small muted">
          Places © OpenStreetMap contributors. Booking links open a search with your dates and group size; prices and availability are on the booking
          site.
        </p>
      )}
    </>
  );
}
