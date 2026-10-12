import { Fragment, useMemo, useState } from "react";
import { buildSchedule, type ScheduleStop } from "../../shared/schedule";
import type { Place, RoutePlan, TollHit, Trip } from "../../shared/types";
import { clock, dayLabel, defaultDeparture, distanceShort, duration, km } from "../format";

const ARROWS: Record<string, string> = {
  left: "←",
  "slight left": "↖",
  "sharp left": "↰",
  right: "→",
  "slight right": "↗",
  "sharp right": "↱",
  straight: "↑",
  uturn: "↶",
};

function arrowFor(type: string, modifier?: string) {
  if (type === "depart") return "●";
  if (type === "arrive") return "◆";
  if (type.includes("roundabout") || type.includes("rotary")) return "↻";
  return (modifier && ARROWS[modifier]) || "↑";
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

interface Props {
  trip: Trip;
  plan: RoutePlan;
  points: Place[];
  tolls: TollHit[];
  selectedLeg: number | null;
  onSelectLeg: (i: number | null) => void;
  onFocus: (lat: number, lng: number) => void;
  updateSettings: (patch: Partial<Trip["settings"]>) => void;
  /** change a stop's overnight choice; `pointIndex` is its index in the visiting order */
  updatePoint: (pointIndex: number, patch: Partial<Place>) => void;
}

type Choice = "auto" | "sleep" | "drive";
const choiceOf = (p: Place): Choice => (p.overnight === true ? "sleep" : p.overnight === false ? "drive" : "auto");

function StopRow({
  place,
  index,
  stop,
  defaultTime,
  autoOn,
  onChange,
}: {
  place: Place;
  index: number;
  stop: ScheduleStop;
  defaultTime: string;
  autoOn: boolean;
  onChange: (patch: Partial<Place>) => void;
}) {
  const choice = choiceOf(place);
  const set = (c: Choice) =>
    onChange(c === "sleep" ? { overnight: true } : c === "drive" ? { overnight: false, nights: undefined, departTime: undefined } : { overnight: undefined, nights: undefined, departTime: undefined });
  return (
    <div className={`stop-row${stop.overnight ? " sleeping" : ""}`}>
      <div className="stop-row-head">
        <span className="plate">{index}</span>
        <span className="grow">
          <strong>{place.name}</strong>
          <span className="small muted" style={{ display: "block" }}>
            Arrive {stop.arrive ? clock(stop.arrive) : ""}
            {stop.overnight
              ? `, sleep ${stop.nights > 1 ? `${stop.nights} nights` : "here"}${stop.auto ? " (chosen automatically)" : ""}, leave ${stop.depart ? `${dayLabel(stop.depart)} ${clock(stop.depart)}` : ""}`
              : place.stayMinutes
                ? `, stay ${place.stayMinutes} min, leave ${stop.depart ? clock(stop.depart) : ""}`
                : ""}
          </span>
        </span>
      </div>
      <div className="row wrap small">
        <span className="muted">Overnight</span>
        <div className="segmented" role="group" aria-label={`Overnight at ${place.name}`}>
          <button aria-pressed={choice === "auto"} onClick={() => set("auto")} title={autoOn ? "Sleep here only if the day gets too long" : "Automatic overnights are off"}>
            Auto
          </button>
          <button aria-pressed={choice === "sleep"} onClick={() => set("sleep")}>
            Sleep here
          </button>
          <button aria-pressed={choice === "drive"} onClick={() => set("drive")} title="Never stop overnight here">
            Drive on
          </button>
        </div>
      </div>
      {choice === "sleep" && (
        <div className="row wrap small">
          <label className="row">
            Nights
            <input
              className="input fee-input num"
              style={{ width: 64 }}
              type="number"
              min={1}
              max={30}
              value={place.nights ?? 1}
              onChange={(e) => onChange({ nights: Math.min(30, Math.max(1, Math.round(Number(e.target.value)) || 1)) })}
            />
          </label>
          <label className="row">
            Leave at
            <input
              className="input"
              style={{ width: "auto", minHeight: 30 }}
              type="time"
              value={place.departTime ?? defaultTime}
              onChange={(e) => onChange({ departTime: e.target.value || undefined })}
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function DirectionsPanel({ trip, plan, points, tolls, selectedLeg, onSelectLeg, onFocus, updateSettings, updatePoint }: Props) {
  const [openLegs, setOpenLegs] = useState<Set<number>>(new Set());
  const departure = trip.settings.departure || defaultDeparture();
  const autoOn = trip.settings.autoOvernight !== false;
  const schedule = useMemo(
    () => buildSchedule(new Date(departure), plan.legs.map((l) => l.duration), points, trip.settings.maxDriveHoursPerDay, autoOn),
    [departure, plan, points, trip.settings.maxDriveHoursPerDay, autoOn],
  );
  const defaultTime = hhmm(new Date(departure));
  const nights = schedule.stops.filter((s) => s.overnight).reduce((n, s) => n + s.nights, 0);

  const toggle = (i: number) => {
    const next = new Set(openLegs);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setOpenLegs(next);
    onSelectLeg(next.has(i) ? i : null);
  };

  const tollsByLeg = useMemo(() => {
    const m = new Map<number, TollHit[]>();
    for (const t of tolls) m.set(t.leg, [...(m.get(t.leg) ?? []), t]);
    return m;
  }, [tolls]);

  const lastLeg = plan.legs.length - 1;

  return (
    <>
      <div className="section no-print">
        <div className="grid-2">
          <label className="field">
            Departure
            <input className="input" type="datetime-local" value={departure} onChange={(e) => updateSettings({ departure: e.target.value || undefined })} />
          </label>
          <label className="field">
            Max driving per day (hours)
            <input
              className="input"
              type="number"
              min={1}
              max={24}
              step={0.5}
              value={trip.settings.maxDriveHoursPerDay}
              onChange={(e) => updateSettings({ maxDriveHoursPerDay: Math.min(24, Math.max(1, Number(e.target.value) || 8)) })}
            />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={autoOn} onChange={(e) => updateSettings({ autoOvernight: e.target.checked })} />
          Add overnight stops automatically when a day goes over the limit
        </label>
        <p className="small" style={{ margin: 0 }}>
          <strong>{duration(schedule.drivingSeconds)}</strong> of driving over{" "}
          <strong>
            {schedule.days} day{schedule.days > 1 ? "s" : ""}
          </strong>
          {nights > 0 ? ` with ${nights} night${nights > 1 ? "s" : ""} away` : ""}, arriving {dayLabel(schedule.arrival)} at {clock(schedule.arrival)}. Choose
          where to sleep at each stop below.
        </p>
        {schedule.overLimitDays.length > 0 && (
          <div className="notice">
            {schedule.overLimitDays
              .map((d) => `Day ${d} has ${duration(schedule.drivingPerDay[d - 1])} of driving`)
              .join("; ")}{" "}
            — more than your {trip.settings.maxDriveHoursPerDay} h limit.
            {schedule.longLegs.length > 0 &&
              ` Leg ${schedule.longLegs.map((l) => l + 1).join(", ")} ${schedule.longLegs.length === 1 ? "is" : "are"} longer than a day on ${schedule.longLegs.length === 1 ? "its" : "their"} own; add a stop in between to break ${schedule.longLegs.length === 1 ? "it" : "them"} up.`}
          </div>
        )}
        <div className="row">
          <button className="btn small" onClick={() => setOpenLegs(new Set(plan.legs.map((_, i) => i)))}>
            Expand all
          </button>
          <button className="btn small" onClick={() => setOpenLegs(new Set())}>
            Collapse all
          </button>
          <button className="btn small" onClick={() => (setOpenLegs(new Set(plan.legs.map((_, i) => i))), setTimeout(() => window.print(), 100))}>
            Print directions
          </button>
        </div>
      </div>

      <div>
        {plan.legs.map((leg, i) => {
          const from = points[i];
          const to = points[i + 1];
          const dep = schedule.stops[i];
          const arr = schedule.stops[i + 1];
          const newDay = i === 0 || dep.overnight;
          const legTolls = tollsByLeg.get(i) ?? [];
          return (
            <Fragment key={i}>
              {newDay && (
                <div className="day-break">
                  Day {i === 0 ? 1 : dep.day + dep.nights} ∙ {dep.depart ? dayLabel(dep.depart) : ""}
                  {i > 0 ? ` ∙ from ${from?.name}` : ""}
                  <span className="day-drive">{duration(schedule.drivingPerDay[(i === 0 ? 1 : dep.day + dep.nights) - 1])} driving</span>
                </div>
              )}
              <div className={`leg${selectedLeg === i ? " selected" : ""}`}>
                <button className="leg-head" onClick={() => toggle(i)} aria-expanded={openLegs.has(i)} aria-label={`Leg ${i + 1}: ${from?.name ?? "Start"} to ${to?.name ?? "End"}`}>
                  <span className="leg-road" aria-hidden="true" />
                  <span>
                    <span className="leg-title">
                      {from?.name ?? "Start"} to {to?.name ?? "End"}
                    </span>
                    <span className="leg-sub" style={{ display: "block" }}>
                      {km(leg.distance)} ∙ {duration(leg.duration)}
                      {leg.summary ? ` ∙ via ${leg.summary}` : ""}
                      {legTolls.length ? ` ∙ ${legTolls.length} toll${legTolls.length > 1 ? "s" : ""}` : ""}
                    </span>
                  </span>
                  <span className="small num" style={{ textAlign: "right" }}>
                    {dep.depart ? clock(dep.depart) : ""}
                    <br />
                    <span className="muted">{arr.arrive ? clock(arr.arrive) : ""}</span>
                  </span>
                </button>
                {openLegs.has(i) && (
                  <ol className="steps">
                    {leg.steps.map((s, k) => (
                      <li key={k}>
                        <span className="arrow" aria-hidden="true">
                          {arrowFor(s.type, s.modifier)}
                        </span>
                        <button onClick={() => onFocus(s.location[0], s.location[1])} title="Show on map">
                          {s.instruction}
                        </button>
                        <span className="muted num">{s.distance > 0 ? distanceShort(s.distance) : ""}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              {i < lastLeg && to && (
                <StopRow
                  place={to}
                  index={i + 1}
                  stop={arr}
                  defaultTime={defaultTime}
                  autoOn={autoOn}
                  onChange={(patch) => updatePoint(i + 1, patch)}
                />
              )}
            </Fragment>
          );
        })}
        <div className="stop-row arrival">
          <div className="stop-row-head">
            <span className="plate end">B</span>
            <span className="grow">
              <strong>{points[points.length - 1]?.name}</strong>
              <span className="small muted" style={{ display: "block" }}>
                Arrive {dayLabel(schedule.arrival)} at {clock(schedule.arrival)}
              </span>
            </span>
          </div>
        </div>
      </div>
      <p className="small muted">
        Times are estimates without live traffic. Directions © OpenStreetMap contributors, routed with OSRM.
      </p>
    </>
  );
}
