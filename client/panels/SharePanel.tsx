import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { googleMapsParts, googleMapsUrl, parseGoogleMapsUrl, GOOGLE_MAX_POINTS } from "../../shared/google";
import { importTrip, newId, toCsv, toGpx, toJson, toKml, tripFromPoints, type ImportResult } from "../../shared/formats";
import { isInSouthAfrica } from "../../shared/southAfrica";
import type { Place, RoutePlan, Trip, Visibility } from "../../shared/types";
import { download, slug } from "../format";

export interface SavedInfo {
  id: string;
  visibility: Visibility;
  shareToken?: string;
}

interface Props {
  trip: Trip;
  plan: RoutePlan | null;
  points: Place[];
  update: (fn: (t: Trip) => Trip) => void;
  saved: SavedInfo | null;
  onSave: (visibility: Visibility) => Promise<void>;
  onRotateToken: () => Promise<void>;
  onImport: (r: ImportResult) => void;
  onNew: () => void;
  saving: boolean;
  toast: (t: string, err?: boolean) => void;
}

const VIS: Array<{ v: Visibility; label: string; help: string }> = [
  { v: "private", label: "Private", help: "Only you can see it." },
  { v: "unlisted", label: "Anyone with the link", help: "Not listed publicly. People with the link see your start and end as towns." },
  { v: "public", label: "Public", help: "Listed on Community routes for others to find and vote on. Start and end show as towns." },
];

export function SharePanel({ trip, plan, points, update, saved, onSave, onRotateToken, onImport, onNew, saving, toast }: Props) {
  const [visibility, setVisibility] = useState<Visibility>(saved?.visibility ?? "private");
  const [gmapsLink, setGmapsLink] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [rangeFromRaw, setRangeFrom] = useState(0);
  const [rangeToRaw, setRangeTo] = useState(GOOGLE_MAX_POINTS - 1);
  // keep the custom range valid as stops are added or removed
  const rangeFrom = Math.max(0, Math.min(rangeFromRaw, points.length - 2));
  const rangeTo = Math.max(rangeFrom + 1, Math.min(rangeToRaw, points.length - 1));
  const fileRef = useRef<HTMLInputElement>(null);

  const parts = useMemo(() => googleMapsParts(points), [points]);
  const shareUrl = saved?.shareToken && saved.visibility !== "private" ? `${location.origin}/s/${saved.shareToken}` : null;
  const name = slug(trip.title);

  const finishImport = (r: ImportResult) => {
    const all = [r.trip.start, ...r.trip.stops, r.trip.end].filter(Boolean) as Place[];
    const outside = all.filter((p) => !isInSouthAfrica(p.lat, p.lng));
    if (outside.length) {
      r.trip.stops = r.trip.stops.filter((p) => isInSouthAfrica(p.lat, p.lng));
      if (r.trip.start && !isInSouthAfrica(r.trip.start.lat, r.trip.start.lng)) r.trip.start = null;
      if (r.trip.end && !isInSouthAfrica(r.trip.end.lat, r.trip.end.lng)) r.trip.end = null;
      r.warnings.push(`${outside.length} place${outside.length > 1 ? "s" : ""} outside South Africa ${outside.length > 1 ? "were" : "was"} left out.`);
      r.plan = null;
    }
    if (r.trip.stops.length > 100) {
      r.warnings.push(`Only the first 100 of ${r.trip.stops.length} stops were kept.`);
      r.trip.stops = r.trip.stops.slice(0, 100);
      r.plan = null;
    }
    onImport(r);
    setImportMsg({ text: [`Imported "${r.trip.title}" with ${r.trip.stops.length} stops.`, ...r.warnings].join(" ") });
  };

  const onFile = async (f: File) => {
    setImportMsg(null);
    try {
      if (f.size > 15 * 1024 * 1024) throw new Error("That file is over 15 MB");
      finishImport(importTrip(f.name, await f.text()));
    } catch (e) {
      setImportMsg({ text: `Couldn't import ${f.name}: ${(e as Error).message}`, error: true });
    }
  };

  const importGoogle = async () => {
    setImportMsg(null);
    setImporting(true);
    try {
      const entries = parseGoogleMapsUrl(gmapsLink);
      if (entries.length < 2) throw new Error("The link needs at least two places");
      const places: Place[] = [];
      const missing: string[] = [];
      for (const e of entries) {
        if (Number.isFinite(e.lat)) {
          places.push({ id: newId(), name: e.name, lat: e.lat, lng: e.lng, kind: "custom" });
          continue;
        }
        const r = await api.search(e.name, places.at(-1));
        if (r[0]) places.push({ id: newId(), name: r[0].name, address: r[0].address, lat: r[0].lat, lng: r[0].lng, kind: r[0].kind, city: r[0].city });
        else missing.push(e.name);
      }
      if (places.length < 2) throw new Error("Couldn't find enough of those places in South Africa");
      const result: ImportResult = { trip: tripFromPoints(places, "Trip from Google Maps"), plan: null, warnings: [] };
      if (missing.length) result.warnings.push(`Not found: ${missing.join(", ")}.`);
      finishImport(result);
      setGmapsLink("");
    } catch (e) {
      setImportMsg({ text: (e as Error).message, error: true });
    } finally {
      setImporting(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Link copied");
    } catch {
      prompt("Copy this link", text);
    }
  };

  const rangeUrl = useMemo(() => {
    if (points.length < 2 || rangeTo <= rangeFrom) return null;
    const slice = points.slice(rangeFrom, rangeTo + 1);
    if (slice.length > GOOGLE_MAX_POINTS) return null;
    return googleMapsUrl(slice);
  }, [points, rangeFrom, rangeTo]);

  return (
    <>
      <div className="section">
        <h3>Save</h3>
        <label className="field">
          Description
          <textarea
            className="input"
            maxLength={4000}
            value={trip.description ?? ""}
            placeholder="What makes this trip worth driving? Shown on shared and public routes."
            onChange={(e) => update((t) => ({ ...t, description: e.target.value || undefined }))}
          />
        </label>
        <fieldset className="section" style={{ border: 0, padding: 0, margin: 0, gap: 6 }}>
          <legend className="field" style={{ marginBottom: 6 }}>
            Who can see it
          </legend>
          {VIS.map((o) => (
            <label key={o.v} className="check" style={{ alignItems: "start" }}>
              <input type="radio" name="vis" checked={visibility === o.v} onChange={() => setVisibility(o.v)} style={{ marginTop: 2 }} />
              <span>
                <strong>{o.label}</strong>
                <span className="muted" style={{ display: "block" }}>
                  {o.help}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {visibility !== "private" && (
          <div className="notice">
            Shared copies replace your start{trip.settings.roundTrip ? "" : " and end"} with the town {trip.settings.roundTrip ? "it's" : "they're"} in, remove the
            route line and directions within 5 km of them, and never include stop notes. To hide a stop too, open its details on the Stops tab and tick "Show only the town".
          </div>
        )}
        <div className="row wrap">
          <button className="btn primary" onClick={() => onSave(visibility)} disabled={saving || !trip.start}>
            {saving ? <span className="spinner" /> : null}
            {saved ? "Save changes" : "Save trip"}
          </button>
          {saved && (
            <button className="btn" onClick={onNew}>
              Start a new trip
            </button>
          )}
        </div>
        {!plan && trip.start && <p className="small muted">Tip: plan the route before saving so others see the full route.</p>}
        {shareUrl && (
          <div className="section" style={{ gap: 6 }}>
            <label className="field">
              Share link
              <div className="row">
                <input className="input grow" readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
                <button className="btn" onClick={() => copy(shareUrl)}>
                  Copy
                </button>
              </div>
            </label>
            <div className="row wrap small">
              <Link to={`/s/${saved!.shareToken}`}>See what others see</Link>
              <button className="btn ghost small" onClick={onRotateToken}>
                Replace link (old link stops working)
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="section">
        <h3>Open in Google Maps</h3>
        {points.length < 2 ? (
          <p className="small muted" style={{ margin: 0 }}>
            Add a start and destination first.
          </p>
        ) : (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              Google Maps takes up to {GOOGLE_MAX_POINTS} places per link, so longer trips open in parts that follow on from each other. Google may choose slightly different
              roads.
            </p>
            <ul className="list">
              {parts.map((p, i) => (
                <li key={i} className="row">
                  <span className="plate">{i + 1}</span>
                  <span className="grow small">
                    {p.label}
                    <span className="muted"> (places {p.from + 1}–{p.to + 1})</span>
                  </span>
                  <a className="btn small" href={p.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </li>
              ))}
            </ul>
            <div className="row wrap small">
              <span>Or open from</span>
              <select className="input" style={{ width: "auto" }} value={rangeFrom} onChange={(e) => setRangeFrom(Number(e.target.value))} aria-label="From place">
                {points.slice(0, -1).map((p, i) => (
                  <option key={i} value={i}>
                    {i + 1}. {p.name}
                  </option>
                ))}
              </select>
              <span>to</span>
              <select className="input" style={{ width: "auto" }} value={rangeTo} onChange={(e) => setRangeTo(Number(e.target.value))} aria-label="To place">
                {points.map((p, i) =>
                  i > rangeFrom ? (
                    <option key={i} value={i}>
                      {i + 1}. {p.name}
                    </option>
                  ) : null,
                )}
              </select>
              {rangeUrl ? (
                <a className="btn small" href={rangeUrl} target="_blank" rel="noreferrer">
                  Open this part
                </a>
              ) : (
                <span className="muted">Pick up to {GOOGLE_MAX_POINTS} places</span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="section">
        <h3>Export</h3>
        <div className="row wrap">
          <button className="btn small" disabled={!trip.start} onClick={() => download(`${name}.gpx`, toGpx(trip, plan), "application/gpx+xml")}>
            GPX
          </button>
          <button className="btn small" disabled={!trip.start} onClick={() => download(`${name}.kml`, toKml(trip, plan), "application/vnd.google-earth.kml+xml")}>
            KML
          </button>
          <button className="btn small" disabled={!trip.start} onClick={() => download(`${name}.csv`, toCsv(trip), "text/csv")}>
            CSV
          </button>
          <button className="btn small" disabled={!trip.start} onClick={() => download(`${name}.padkos.json`, toJson(trip, plan), "application/json")}>
            Padkos file
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          GPX works with Garmin, OsmAnd and most GPS apps. KML opens in Google Earth and My Maps. The Padkos file keeps everything, including the planned route.
        </p>
      </div>

      <div className="section">
        <h3>Import</h3>
        <div className="row wrap">
          <button className="btn small" onClick={() => fileRef.current?.click()}>
            Choose a file
          </button>
          <span className="small muted">GPX, KML, CSV (name, lat, lng) or a Padkos file</span>
          <input
            ref={fileRef}
            type="file"
            accept=".gpx,.kml,.csv,.json,application/json,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
        </div>
        <label className="field">
          Or paste a Google Maps directions link
          <div className="row">
            <input
              className="input grow"
              value={gmapsLink}
              onChange={(e) => setGmapsLink(e.target.value)}
              placeholder="https://www.google.com/maps/dir/…"
            />
            <button className="btn" disabled={!gmapsLink.trim() || importing} onClick={importGoogle}>
              {importing ? <span className="spinner" /> : "Import"}
            </button>
          </div>
        </label>
        {importMsg && <div className={`notice${importMsg.error ? " error" : " ok"}`}>{importMsg.text}</div>}
        <p className="small muted" style={{ margin: 0 }}>
          Importing replaces the trip you're editing. Save it first if you want to keep it.
        </p>
      </div>
    </>
  );
}
