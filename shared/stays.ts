// Overnight stops, the accommodation budget and search links to booking sites.
import { formatRand } from "./fuel";
import { buildSchedule } from "./schedule";
import type { Place, RoutePlan, SavedStay, StayKind, Trip } from "./types";

export const STAY_KIND_LABELS: Record<StayKind, string> = {
  hotel: "Hotel",
  motel: "Motel",
  guest_house: "Guest house / B&B",
  hostel: "Backpackers",
  chalet: "Chalet",
  apartment: "Self-catering",
  camp_site: "Campsite",
  caravan_site: "Caravan park",
  alpine_hut: "Mountain hut",
  wilderness_hut: "Wilderness hut",
};

export const MAX_SAVED_STAYS = 20;

export interface Overnight {
  /** index of the place in the visiting order (see tripPoints) */
  pointIndex: number;
  place: Place;
  /** local dates, YYYY-MM-DD */
  checkIn: string;
  checkOut: string;
  nights: number;
  /** chosen automatically from the daily driving limit */
  auto: boolean;
  /** nights at the destination after the trip's last leg */
  destination: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Check-in and check-out dates; arriving in the small hours (before 06:00) still counts as the previous night. */
export function stayDates(arrive: Date, nights: number): [string, string] {
  const d = new Date(arrive.getTime() - 6 * 3600_000);
  const checkIn = ymd(d);
  d.setDate(d.getDate() + nights);
  return [checkIn, ymd(d)];
}

/** Every night away, in trip order: overnight stops from the schedule, then nights at the destination. */
export function overnights(trip: Trip, plan: RoutePlan, points: Place[], departure: Date): Overnight[] {
  const schedule = buildSchedule(
    departure,
    plan.legs.map((l) => l.duration),
    points,
    trip.settings.maxDriveHoursPerDay,
    trip.settings.autoOvernight !== false,
  );
  const out: Overnight[] = [];
  for (const s of schedule.stops) {
    const place = points[s.index];
    if (!s.overnight || !s.arrive || !place) continue;
    const [checkIn, checkOut] = stayDates(s.arrive, s.nights);
    out.push({ pointIndex: s.index, place, checkIn, checkOut, nights: s.nights, auto: s.auto, destination: false });
  }
  const end = trip.end;
  if (!trip.settings.roundTrip && end && (end.nights ?? 0) > 0) {
    const [checkIn, checkOut] = stayDates(schedule.arrival, end.nights!);
    out.push({ pointIndex: points.length - 1, place: end, checkIn, checkOut, nights: end.nights!, auto: false, destination: true });
  }
  return out;
}

/** Cheapest and dearest nightly price among the saved stays; a chosen stay with a price stands alone. */
export function nightlyRange(stays: SavedStay[] = []): { min: number; max: number } | null {
  const priced = stays.filter((s) => s.price != null && Number.isFinite(s.price));
  const chosen = priced.find((s) => s.chosen);
  if (chosen) return { min: chosen.price!, max: chosen.price! };
  if (!priced.length) return null;
  const prices = priced.map((s) => s.price!);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

export interface StayBudget {
  min: number;
  max: number;
  nights: number;
  budgetedNights: number;
  /** nights away with no priced stay saved yet */
  unbudgeted: Overnight[];
}

export function stayBudget(list: Overnight[]): StayBudget {
  const b: StayBudget = { min: 0, max: 0, nights: 0, budgetedNights: 0, unbudgeted: [] };
  for (const o of list) {
    b.nights += o.nights;
    const r = nightlyRange(o.place.stays);
    if (!r) {
      b.unbudgeted.push(o);
      continue;
    }
    b.budgetedNights += o.nights;
    b.min += r.min * o.nights;
    b.max += r.max * o.nights;
  }
  return b;
}

export type BookingSite = "booking" | "airbnb" | "agoda";
export const BOOKING_SITE_LABELS: Record<BookingSite, string> = { booking: "Booking.com", airbnb: "Airbnb", agoda: "Agoda" };

export interface AffiliateIds {
  booking?: string;
  agoda?: string;
}

export interface StaySearch {
  /** what to search for: a town, or a property name and its town */
  query: string;
  checkIn: string;
  checkOut: string;
  adults: number;
}

/** Search-results links on the booking sites, pre-filled with the place, dates and party size. */
export function bookingSiteUrl(site: BookingSite, q: StaySearch, ids: AffiliateIds = {}): string {
  const adults = String(Math.max(1, Math.round(q.adults)));
  if (site === "booking") {
    const u = new URL("https://www.booking.com/searchresults.html");
    u.search = new URLSearchParams({ ss: q.query, checkin: q.checkIn, checkout: q.checkOut, group_adults: adults, group_children: "0", no_rooms: "1" }).toString();
    if (ids.booking) u.searchParams.set("aid", ids.booking);
    return u.toString();
  }
  if (site === "agoda") {
    const u = new URL("https://www.agoda.com/search");
    u.search = new URLSearchParams({ textToSearch: q.query, checkIn: q.checkIn, checkOut: q.checkOut, adults, rooms: "1" }).toString();
    if (ids.agoda) u.searchParams.set("cid", ids.agoda);
    return u.toString();
  }
  const u = new URL(`https://www.airbnb.co.za/s/${encodeURIComponent(q.query)}/homes`);
  u.search = new URLSearchParams({ checkin: q.checkIn, checkout: q.checkOut, adults }).toString();
  return u.toString();
}

/** The town to search for accommodation around a stop. */
export const townOf = (p: Place) => p.city ?? p.name;

/**
 * A link typed in by the traveller, made safe to use as an href: bare domains get https://,
 * anything that isn't http(s) is refused.
 */
export function normaliseUrl(input: string | undefined): string | undefined {
  const s = input?.trim();
  if (!s || s.length > 2000) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function formatRandRange(min: number, max: number): string {
  return min === max ? formatRand(min) : `${formatRand(min)} – ${formatRand(max)}`;
}
