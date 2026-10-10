import type { Place, RouteAlternative, RoutePlan } from "../../shared/types";
import { findTolls, totalTolls } from "../../shared/tolls";
import { formatRand } from "../../shared/fuel";
import { distinguishingTowns } from "../../shared/towns";
import { useMemo } from "react";
import { duration, km } from "../format";

interface Props {
  plan: RoutePlan;
  points: Place[];
  leg: number;
  setLeg: (i: number) => void;
  alternatives: RouteAlternative[] | null;
  loading: boolean;
  error: string | null;
  onFetch: () => void;
  onChoose: (i: number) => void;
  tollOverrides?: Record<string, number>;
}

function signed(v: number, fmt: (x: number) => string) {
  if (Math.abs(v) < 1) return "same";
  return `${v > 0 ? "+" : "−"}${fmt(Math.abs(v))}`;
}

export function AlternativesPanel({ plan, points, leg, setLeg, alternatives, loading, error, onFetch, onChoose, tollOverrides }: Props) {
  const current = plan.legs[leg];
  const currentTolls = totalTolls(findTolls([current.geometry], tollOverrides));
  const fastest = alternatives ? Math.min(...alternatives.map((a) => a.duration)) : 0;
  const via = useMemo(() => (alternatives ? distinguishingTowns(alternatives.map((a) => a.geometry)) : []), [alternatives]);
  const withTolls = alternatives?.map((a) => ({ alt: a, tolls: totalTolls(findTolls([a.geometry], tollOverrides)) }));
  const cheapest = withTolls ? Math.min(...withTolls.map((x) => x.tolls)) : 0;

  return (
    <>
      <div className="section">
        <p className="small muted" style={{ margin: 0 }}>
          Compare other ways to drive each leg. The map shows them as grey dashed lines; choose one to use it for this trip.
        </p>
        {plan.legs.length > 1 && (
          <label className="field">
            Leg
            <select className="input" value={leg} onChange={(e) => setLeg(Number(e.target.value))}>
              {plan.legs.map((l, i) => (
                <option key={i} value={i}>
                  {i + 1}. {points[i]?.name} to {points[i + 1]?.name} ({km(l.distance)})
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="small">
          Current: <strong>{km(current.distance)}</strong>, <strong>{duration(current.duration)}</strong>
          {current.summary ? ` via ${current.summary}` : ""}, tolls {formatRand(currentTolls)}
        </div>
        {!alternatives && (
          <button className="btn primary" onClick={onFetch} disabled={loading}>
            {loading ? <span className="spinner" /> : null} Find alternative routes
          </button>
        )}
        {error && <div className="notice error">{error}</div>}
      </div>

      {withTolls && (
        <div className="section">
          {withTolls.length === 1 && <p className="small muted">No reasonable alternative exists for this leg — the current route is the only sensible one.</p>}
          {withTolls.map(({ alt, tolls }, i) => {
            const isCurrent = alt.geometry === current.geometry;
            const tags = [
              alt.duration === fastest ? "fastest" : null,
              tolls === cheapest && cheapest < currentTolls ? "fewest tolls" : null,
              tolls === 0 ? "toll-free" : null,
            ].filter(Boolean);
            return (
              <button key={i} className="alt" aria-pressed={isCurrent} onClick={() => onChoose(i)}>
                <span
                  className="swatch"
                  aria-hidden="true"
                  style={{ background: isCurrent ? "#232B2F" : "repeating-linear-gradient(90deg, #7d8a90 0 6px, transparent 6px 10px)" }}
                />
                <span>
                  <strong>
                    {via[i] ? `Via ${via[i]}` : alt.summary || `Route ${i + 1}`}
                    {via[i] && alt.summary ? <span className="muted"> ({alt.summary})</span> : null}
                  </strong>
                  <span className="small muted" style={{ display: "block" }}>
                    {km(alt.distance)} ∙ {duration(alt.duration)} ∙ tolls {formatRand(tolls)}
                    {tags.length ? ` ∙ ${tags.join(", ")}` : ""}
                  </span>
                  {!isCurrent && (
                    <span className="small" style={{ display: "block" }}>
                      {signed(alt.duration - current.duration, duration)} time, {signed(alt.distance - current.distance, (x) => km(x))},{" "}
                      {signed(tolls - currentTolls, (x) => formatRand(x))} tolls
                    </span>
                  )}
                </span>
                <span className="small">{isCurrent ? "In use" : "Use this"}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
