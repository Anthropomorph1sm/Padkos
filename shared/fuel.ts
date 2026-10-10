import type { FuelSettings, FuelType } from "./types";

/**
 * Default pump prices (Rand/litre) used to pre-fill the calculator.
 * South African fuel prices are regulated and change on the first Wednesday of each month,
 * and coastal prices are slightly lower than inland (Gauteng) prices — users should edit these.
 */
export const DEFAULT_FUEL_PRICES: Record<FuelType, { inland: number; coastal: number; label: string }> = {
  "95": { inland: 21.6, coastal: 20.8, label: "Petrol 95 ULP" },
  "93": { inland: 21.4, coastal: 20.6, label: "Petrol 93 ULP" },
  diesel: { inland: 19.9, coastal: 19.1, label: "Diesel 50ppm" },
};

/** Convert any supported economy figure to litres per 100 km. */
export function toLitresPer100(unit: FuelSettings["unit"], value: number): number {
  if (!Number.isFinite(value) || value <= 0) return NaN;
  return unit === "l100" ? value : 100 / value;
}

/** Convert litres per 100 km to km per litre (and vice versa — the conversion is symmetric). */
export function convertEconomy(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return NaN;
  return 100 / value;
}

export interface FuelEstimate {
  litres: number;
  cost: number;
  litresPer100: number;
  kmPerLitre: number;
  /** number of fill-ups needed when a tank size is given (excludes the initial full tank) */
  refuels?: number;
  /** usable range on a full tank in km (with a 10% reserve) */
  rangeKm?: number;
}

export function estimateFuel(distanceMetres: number, fuel: FuelSettings): FuelEstimate {
  const l100 = toLitresPer100(fuel.unit, fuel.value);
  const km = distanceMetres / 1000;
  const litres = Number.isFinite(l100) ? (km * l100) / 100 : 0;
  const cost = litres * (Number.isFinite(fuel.pricePerLitre) ? fuel.pricePerLitre : 0);
  const est: FuelEstimate = {
    litres,
    cost,
    litresPer100: l100,
    kmPerLitre: Number.isFinite(l100) ? 100 / l100 : NaN,
  };
  if (fuel.tankLitres && fuel.tankLitres > 0 && Number.isFinite(l100)) {
    const usable = fuel.tankLitres * 0.9;
    est.rangeKm = (usable / l100) * 100;
    est.refuels = Math.max(0, Math.ceil(km / est.rangeKm) - 1);
  }
  return est;
}

export function formatRand(v: number, decimals = 0): string {
  if (!Number.isFinite(v)) return "R –";
  return (
    "R " +
    v.toLocaleString("en-ZA", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).replace(/ /g, " ")
  );
}
