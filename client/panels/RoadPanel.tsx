import { formatRand } from "../../shared/fuel";
import { totalTolls } from "../../shared/tolls";
import type { RoadIssue, TollHit } from "../../shared/types";
import { km } from "../format";

export interface IssuesState {
  loading: boolean;
  issues: RoadIssue[] | null;
  errors: string[];
  tomtom: boolean;
}

interface Props {
  tolls: TollHit[];
  issues: IssuesState;
  onLoad: () => void;
  onFocus: (lat: number, lng: number) => void;
}

const KIND_LABEL: Record<RoadIssue["kind"], string> = {
  construction: "Under construction",
  roadworks: "Road works",
  closure: "Closure",
  incident: "Incident",
};

export function RoadPanel({ tolls, issues, onLoad, onFocus }: Props) {
  return (
    <>
      <div className="section">
        <div className="section-head">
          <h3>Road works and incidents</h3>
          {issues.issues && (
            <button className="btn small" onClick={onLoad} disabled={issues.loading}>
              Refresh
            </button>
          )}
        </div>
        {issues.loading && (
          <p className="small muted row">
            <span className="spinner" /> Checking the whole route — long trips take up to a minute.
          </p>
        )}
        {!issues.loading && !issues.issues && (
          <button className="btn primary" onClick={onLoad}>
            Check this route for road works
          </button>
        )}
        {issues.errors.map((e) => (
          <div key={e} className="notice">
            {e}
          </div>
        ))}
        {issues.issues && issues.issues.length === 0 && !issues.loading && (
          <div className="notice ok">Nothing reported along this route.</div>
        )}
        {issues.issues && issues.issues.length > 0 && (
          <ul className="list">
            {issues.issues.map((r) => (
              <li key={r.id}>
                <div className="item">
                  <span className="plate works">!</span>
                  <div>
                    <div className="item-title">{r.title}</div>
                    <div className="small muted">
                      {KIND_LABEL[r.kind]}
                      {r.along != null ? ` ∙ ${km(r.along)} into the trip` : ""}
                      {r.delaySeconds ? ` ∙ about ${Math.round(r.delaySeconds / 60)} min delay` : ""}
                    </div>
                    {r.description && <div className="small">{r.description}</div>}
                  </div>
                  <button className="btn small" onClick={() => onFocus(r.lat, r.lng)}>
                    Show
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          {issues.tomtom
            ? "Live closures, road works and incidents come from TomTom; long-running construction comes from OpenStreetMap."
            : "Construction comes from OpenStreetMap mapping, which can lag behind what's happening on the road. Live traffic incidents need a TomTom API key on the server."}{" "}
          For live updates, check SANRAL's i-traffic or your provincial roads department before you leave.
        </p>
      </div>

      <div className="section">
        <div className="section-head">
          <h3>Toll plazas</h3>
          <strong className="num">{formatRand(totalTolls(tolls))}</strong>
        </div>
        {tolls.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            This route has no toll plazas.
          </p>
        ) : (
          <ul className="list">
            {tolls.map((t, i) => (
              <li key={`${t.id}-${i}`}>
                <div className="item">
                  <span className="plate toll">R</span>
                  <div>
                    <div className="item-title">
                      {t.name} <span className="muted small">{t.road}</span>
                    </div>
                    <div className="small muted">
                      {km(t.along)} into the trip ∙ leg {t.leg + 1}
                    </div>
                  </div>
                  <button className="btn small" onClick={() => onFocus(t.lat, t.lng)}>
                    {formatRand(t.fee)}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          Ramp plazas are only counted when the route uses that ramp. Change fees on the Costs tab.
        </p>
      </div>
    </>
  );
}
