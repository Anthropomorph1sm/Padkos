import { useState } from "react";
import { convertEconomy, DEFAULT_FUEL_PRICES, estimateFuel, formatRand } from "../../shared/fuel";
import { totalTolls } from "../../shared/tolls";
import type { FuelSettings, FuelType, TollHit } from "../../shared/types";
import { km } from "../format";

interface Props {
  distance: number;
  fuel: FuelSettings;
  passengers: number;
  tolls: TollHit[];
  onFuel: (patch: Partial<FuelSettings>) => void;
  onPassengers: (n: number) => void;
  onTollFee?: (id: string, fee: number | null) => void;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function CostsPanel({ distance, fuel, passengers, tolls, onFuel, onPassengers, onTollFee }: Props) {
  const [region, setRegion] = useState<"inland" | "coastal">("inland");
  const est = estimateFuel(distance, fuel);
  const tollTotal = totalTolls(tolls);
  const total = est.cost + tollTotal;

  const switchUnit = (unit: FuelSettings["unit"]) => {
    if (unit === fuel.unit) return;
    onFuel({ unit, value: round1(convertEconomy(fuel.value)) || fuel.value });
  };

  return (
    <>
      <div className="section">
        <h3>Fuel</h3>
        <div className="row wrap">
          <label className="field grow">
            Fuel economy
            <input
              className="input"
              type="number"
              min={0.1}
              step={0.1}
              value={fuel.value}
              onChange={(e) => onFuel({ value: Math.max(0, Number(e.target.value)) })}
            />
          </label>
          <div className="segmented" role="group" aria-label="Economy unit" style={{ alignSelf: "end" }}>
            <button aria-pressed={fuel.unit === "l100"} onClick={() => switchUnit("l100")}>
              L/100 km
            </button>
            <button aria-pressed={fuel.unit === "kml"} onClick={() => switchUnit("kml")}>
              km/L
            </button>
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {fuel.unit === "l100"
            ? `That's ${Number.isFinite(est.kmPerLitre) ? round1(est.kmPerLitre) : "–"} km per litre.`
            : `That's ${Number.isFinite(est.litresPer100) ? round1(est.litresPer100) : "–"} litres per 100 km.`}{" "}
          Long-distance highway driving usually uses a little less than the figure on your trip computer.
        </p>
        <div className="grid-2">
          <label className="field">
            Fuel
            <select
              className="input"
              value={fuel.fuelType}
              onChange={(e) => {
                const t = e.target.value as FuelType;
                onFuel({ fuelType: t, pricePerLitre: DEFAULT_FUEL_PRICES[t][region] });
              }}
            >
              {(Object.keys(DEFAULT_FUEL_PRICES) as FuelType[]).map((t) => (
                <option key={t} value={t}>
                  {DEFAULT_FUEL_PRICES[t].label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Price per litre (R)
            <input
              className="input"
              type="number"
              min={0}
              step={0.01}
              value={fuel.pricePerLitre}
              onChange={(e) => onFuel({ pricePerLitre: Math.max(0, Number(e.target.value)) })}
            />
          </label>
        </div>
        <div className="row small">
          <span className="muted">Typical price</span>
          <div className="segmented" role="group" aria-label="Price region">
            {(["inland", "coastal"] as const).map((r) => (
              <button
                key={r}
                aria-pressed={region === r}
                onClick={() => {
                  setRegion(r);
                  onFuel({ pricePerLitre: DEFAULT_FUEL_PRICES[fuel.fuelType][r] });
                }}
              >
                {r === "inland" ? "Inland" : "Coastal"}
              </button>
            ))}
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Pump prices are set monthly by the Department of Mineral Resources and Energy. Check the current price and edit it above.
        </p>
        <div className="grid-2">
          <label className="field">
            Tank size (litres)
            <input
              className="input"
              type="number"
              min={0}
              step={1}
              value={fuel.tankLitres ?? ""}
              onChange={(e) => onFuel({ tankLitres: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)) })}
            />
          </label>
          <label className="field">
            People sharing costs
            <input
              className="input"
              type="number"
              min={1}
              max={100}
              step={1}
              value={passengers}
              onChange={(e) => onPassengers(Math.max(1, Math.round(Number(e.target.value)) || 1))}
            />
          </label>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h3>Tolls</h3>
          <span className="small muted">Class 1 light vehicle</span>
        </div>
        {tolls.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            No toll plazas on this route.
          </p>
        ) : (
          <table className="cost-table">
            <tbody>
              {tolls.map((t, i) => (
                <tr key={`${t.id}-${i}`}>
                  <td>
                    {t.name} <span className="muted small">({t.road})</span>
                    {t.overridden && <span className="muted small"> ∙ edited</span>}
                  </td>
                  <td>
                    {onTollFee ? (
                      <input
                        className="input fee-input num"
                        type="number"
                        min={0}
                        step={0.5}
                        aria-label={`${t.name} toll fee in rand`}
                        value={t.fee}
                        onChange={(e) => onTollFee(t.id, e.target.value === "" ? null : Math.max(0, Number(e.target.value)))}
                      />
                    ) : (
                      formatRand(t.fee, 2)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          Fees are approximate and change every March. Edit a fee to match the current tariff; your edits are saved with the trip.
        </p>
      </div>

      <div className="section">
        <h3>Trip cost</h3>
        <table className="cost-table">
          <tbody>
            <tr>
              <td>Distance</td>
              <td>{km(distance)}</td>
            </tr>
            <tr>
              <td>Fuel needed</td>
              <td>{Number.isFinite(est.litres) ? `${Math.round(est.litres)} L` : "–"}</td>
            </tr>
            {est.rangeKm != null && (
              <tr>
                <td>Range per tank / fill-ups on the way</td>
                <td>
                  {km(est.rangeKm * 1000)} / {est.refuels}
                </td>
              </tr>
            )}
            <tr>
              <td>Fuel cost</td>
              <td>{formatRand(est.cost)}</td>
            </tr>
            <tr>
              <td>Tolls</td>
              <td>{formatRand(tollTotal)}</td>
            </tr>
            <tr className="total">
              <td>Total</td>
              <td>{formatRand(total)}</td>
            </tr>
            {passengers > 1 && (
              <tr>
                <td>Per person ({passengers})</td>
                <td>{formatRand(total / passengers)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
