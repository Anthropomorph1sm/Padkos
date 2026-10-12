import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { decodePolyline, type LatLng } from "../../shared/geo";
import { ZA_CENTER } from "../../shared/southAfrica";
import { STAY_KIND_LABELS } from "../../shared/stays";
import type { Attraction, Place, RoadIssue, StayOption, TollHit } from "../../shared/types";
import { distanceShort, duration, km } from "../format";
import { formatRand } from "../../shared/fuel";

export interface MapLeg {
  geometry: string;
  distance: number;
  duration: number;
}

export interface MapAlternative {
  geometry: string;
  label: string;
  selected: boolean;
  onPick: () => void;
}

export interface MapStay {
  stay: StayOption;
  saved: boolean;
  onSave?: () => void;
}

export interface ClickAction {
  label: string;
  run: (lat: number, lng: number) => void;
  primary?: boolean;
}

interface Props {
  points: Place[];
  roundTrip?: boolean;
  legs?: MapLeg[];
  selectedLeg?: number | null;
  onSelectLeg?: (i: number) => void;
  alternatives?: MapAlternative[];
  attractions?: Attraction[];
  onAddAttraction?: (a: Attraction) => void;
  highlightAttraction?: string | null;
  tolls?: TollHit[];
  issues?: RoadIssue[];
  stays?: MapStay[];
  clickActions?: ClickAction[];
  /** draw an "approximate area" ring around these places (obscured shared routes) */
  approximate?: Place[];
  focus?: { lat: number; lng: number; zoom?: number; key: number } | null;
  /** change this to refit the map to the route */
  fitKey?: string;
  hint?: string;
}

/** Raster basemap. Override with VITE_TILE_URL / VITE_TILE_ATTRIBUTION for a commercial or self-hosted tile server. */
const TILE_URL = import.meta.env.VITE_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  import.meta.env.VITE_TILE_ATTRIBUTION ?? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const plateIcon = (label: string, cls: string) =>
  L.divIcon({ className: "marker-plate", html: `<span class="plate ${cls}">${label}</span>`, iconSize: [28, 24] });

const CATEGORY_GLYPH: Record<string, string> = {
  attraction: "★",
  nature: "▲",
  viewpoint: "◉",
  museum: "M",
  heritage: "H",
  wine: "W",
  beach: "~",
  camping: "C",
  food: "F",
  fuel: "⛽",
};

function attractionIcon(a: Attraction, hot: boolean) {
  return L.divIcon({
    className: "marker-plate",
    html: `<div class="attraction-pin${hot ? " hot" : ""}">${CATEGORY_GLYPH[a.category] ?? "•"}</div>`,
    iconSize: hot ? [22, 22] : [18, 18],
  });
}

const stayIcon = (saved: boolean) =>
  L.divIcon({ className: "marker-plate", html: `<div class="stay-pin${saved ? " saved" : ""}">⌂</div>`, iconSize: [18, 18] });

function FitBounds({ points, legs, fitKey }: { points: Place[]; legs: LatLng[][]; fitKey?: string }) {
  const map = useMap();
  useEffect(() => {
    const all: LatLng[] = [...points.map((p) => [p.lat, p.lng] as LatLng), ...legs.flat()];
    if (!all.length) return;
    if (all.length === 1) {
      map.setView(all[0], 11);
      return;
    }
    map.fitBounds(L.latLngBounds(all.map(([a, b]) => L.latLng(a, b))), { padding: [36, 36], maxZoom: 13 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

function Focus({ focus }: { focus: Props["focus"] }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.setView([focus.lat, focus.lng], focus.zoom ?? Math.max(map.getZoom(), 13));
  }, [focus, map]);
  return null;
}

function ClickMenu({ actions }: { actions: ClickAction[] }) {
  const [pos, setPos] = useState<L.LatLng | null>(null);
  useMapEvents({
    click(e) {
      setPos(e.latlng);
    },
  });
  if (!pos) return null;
  return (
    <Popup position={pos} eventHandlers={{ remove: () => setPos(null) }}>
      <div className="map-popup">
        <span className="small muted num">
          {pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}
        </span>
        {actions.map((a) => (
          <button
            key={a.label}
            className={`btn small${a.primary ? " primary" : ""}`}
            onClick={() => {
              a.run(pos.lat, pos.lng);
              setPos(null);
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </Popup>
  );
}

export function MapView(props: Props) {
  const { points, legs = [], selectedLeg, onSelectLeg, alternatives = [], attractions = [], tolls = [], issues = [] } = props;
  const decodedLegs = useMemo(() => legs.map((l) => decodePolyline(l.geometry)), [legs]);
  const decodedAlts = useMemo(() => alternatives.map((a) => decodePolyline(a.geometry)), [alternatives]);
  const lastIndex = points.length - 1;

  return (
    <div className="map">
      <MapContainer
        center={ZA_CENTER}
        zoom={6}
        minZoom={5}
        maxBounds={[
          [-37.5, 12],
          [-19.5, 37],
        ]}
        style={{ height: "100%", width: "100%" }}
        preferCanvas
        worldCopyJump={false}
      >
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} maxZoom={19} />
        <FitBounds points={points} legs={decodedLegs} fitKey={props.fitKey} />
        <Focus focus={props.focus} />
        {props.clickActions && <ClickMenu actions={props.clickActions} />}

        {/* alternatives under the main route */}
        {decodedAlts.map((line, i) => (
          <Polyline
            key={`alt-${i}`}
            positions={line}
            pathOptions={{ color: alternatives[i].selected ? "#232B2F" : "#7d8a90", weight: 6, opacity: 0.75, dashArray: alternatives[i].selected ? undefined : "8 8" }}
            eventHandlers={{ click: () => alternatives[i].onPick() }}
          >
            <Tooltip sticky className="leg-tip">
              {alternatives[i].label}
            </Tooltip>
          </Polyline>
        ))}

        {/* the route: yellow shoulder lines under an asphalt stroke */}
        {decodedLegs.map((line, i) => {
          const selected = selectedLeg === i;
          return (
            <Polyline key={`edge-${i}`} positions={line} pathOptions={{ color: "#F2B705", weight: selected ? 12 : 9, opacity: 1 }} interactive={false} />
          );
        })}
        {decodedLegs.map((line, i) => {
          const selected = selectedLeg === i;
          return (
            <Polyline
              key={`road-${i}`}
              positions={line}
              pathOptions={{ color: selected ? "#000" : "#232B2F", weight: selected ? 8 : 6, opacity: 1 }}
              eventHandlers={onSelectLeg ? { click: () => onSelectLeg(i) } : undefined}
            >
              <Tooltip sticky className="leg-tip">
                Leg {i + 1}: {km(legs[i].distance)} ∙ {duration(legs[i].duration)}
              </Tooltip>
            </Polyline>
          );
        })}

        {props.approximate?.map((p) => (
          <Circle
            key={`approx-${p.id}-${p.lat}`}
            center={[p.lat, p.lng]}
            radius={6000}
            pathOptions={{ color: "#232B2F", weight: 1.5, dashArray: "4 6", fillColor: "#F2B705", fillOpacity: 0.12 }}
          />
        ))}

        {points.map((p, i) => {
          const isStart = i === 0;
          const isEnd = i === lastIndex && !props.roundTrip;
          if (props.roundTrip && i === lastIndex && points.length > 1) return null;
          const label = isStart ? (props.roundTrip ? "A↺" : "A") : isEnd ? "B" : String(i);
          return (
            <Marker key={`${p.id}-${i}`} position={[p.lat, p.lng]} icon={plateIcon(label, isStart ? "start" : isEnd ? "end" : "")} zIndexOffset={1000}>
              <Popup>
                <strong>{p.name}</strong>
                {p.address && <div className="small muted">{p.address}</div>}
              </Popup>
            </Marker>
          );
        })}

        {attractions.map((a) => {
          const hot = props.highlightAttraction === a.id;
          return (
            <Marker key={a.id} position={[a.lat, a.lng]} icon={attractionIcon(a, hot)} zIndexOffset={hot ? 900 : 0}>
              <Popup>
                <div className="map-popup">
                  <strong>{a.name}</strong>
                  <span className="small muted">
                    {a.kind.replace(/_/g, " ")} ∙ {distanceShort(a.distanceFromRoute)} off the route
                  </span>
                  {a.wikipedia && (
                    <a href={a.wikipedia} target="_blank" rel="noreferrer" className="small">
                      Wikipedia
                    </a>
                  )}
                  {props.onAddAttraction && (
                    <button className="btn small primary" onClick={() => props.onAddAttraction!(a)}>
                      Add to trip
                    </button>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}

        {props.stays?.map(({ stay: s, saved, onSave }) => (
          <Marker key={`stay-${s.id}`} position={[s.lat, s.lng]} icon={stayIcon(saved)} zIndexOffset={saved ? 800 : 0}>
            <Popup>
              <div className="map-popup">
                <strong>{s.name}</strong>
                <span className="small muted">
                  {STAY_KIND_LABELS[s.kind]} ∙ {distanceShort(s.distance)} from the stop
                </span>
                {onSave && (
                  <button className="btn small primary" onClick={onSave} disabled={saved}>
                    {saved ? "Saved" : "Save"}
                  </button>
                )}
              </div>
            </Popup>
          </Marker>
        ))}

        {tolls.map((t, i) => (
          <Marker key={`toll-${t.id}-${i}`} position={[t.lat, t.lng]} icon={plateIcon("R", "toll")}>
            <Tooltip>
              {t.name} toll ({t.road}) ∙ {formatRand(t.fee)}
            </Tooltip>
          </Marker>
        ))}

        {issues.map((r) => (
          <Marker key={r.id} position={[r.lat, r.lng]} icon={plateIcon("!", "works")}>
            <Popup>
              <strong>{r.title}</strong>
              {r.description && <div className="small">{r.description}</div>}
              <div className="small muted">Source: {r.source === "tomtom" ? "TomTom live traffic" : "OpenStreetMap"}</div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      {props.hint && <div className="map-hint">{props.hint}</div>}
    </div>
  );
}
