// Turns leg durations into an itinerary: arrival times, overnight stops and driving days.

export interface SchedulePoint {
  /** minutes spent here before driving on (ignored when sleeping here) */
  stayMinutes?: number;
  /** true = always sleep here, false = never sleep here automatically, undefined = let the schedule decide */
  overnight?: boolean;
  /** nights spent here when sleeping here (default 1) */
  nights?: number;
  /** "HH:MM" to leave the next morning (default: the trip's departure time of day) */
  departTime?: string;
}

export interface ScheduleStop {
  /** index into the visiting-order point list (0 = start) */
  index: number;
  arrive: Date | null;
  depart: Date | null;
  /** day of the trip on which the traveller arrives here */
  day: number;
  /** true when the traveller sleeps here before continuing */
  overnight: boolean;
  /** the overnight was chosen automatically from the daily driving limit */
  auto: boolean;
  nights: number;
}

export interface Schedule {
  stops: ScheduleStop[];
  days: number;
  drivingSeconds: number;
  /** driving seconds per day (index 0 = day 1); rest days have 0 */
  drivingPerDay: number[];
  /** legs that alone exceed the daily driving limit */
  longLegs: number[];
  /** days whose driving exceeds the limit (1-based) */
  overLimitDays: number[];
  arrival: Date;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * @param departure     trip start
 * @param legSeconds    driving time for each leg (points.length - 1 entries)
 * @param points        per-point stay and overnight preferences (index aligned with the visiting order)
 * @param maxDriveHours driving allowed per day
 * @param autoOvernight insert overnight stops automatically when a day would exceed the limit
 */
export function buildSchedule(
  departure: Date,
  legSeconds: number[],
  points: SchedulePoint[],
  maxDriveHours: number,
  autoOvernight = true,
): Schedule {
  const maxDay = Math.max(1, maxDriveHours) * 3600;
  let t = new Date(departure);
  let day = 1;
  let dayDrive = 0;
  const drivingPerDay: number[] = [0];
  const longLegs: number[] = [];
  const stops: ScheduleStop[] = [{ index: 0, arrive: null, depart: new Date(t), day: 1, overnight: false, auto: false, nights: 0 }];

  const sleep = (here: ScheduleStop, nights: number, departTime: string | undefined, auto: boolean) => {
    const m = departTime?.match(TIME_RE);
    const hour = m ? Number(m[1]) : departure.getHours();
    const minute = m ? Number(m[2]) : departure.getMinutes();
    // arriving in the small hours (before 06:00) still counts as the previous night
    const next = new Date(t.getTime() - 6 * 3600_000);
    next.setDate(next.getDate() + nights);
    next.setHours(hour, minute, 0, 0);
    while (next.getTime() <= t.getTime()) next.setDate(next.getDate() + 1);
    here.overnight = true;
    here.auto = auto;
    here.nights = nights;
    here.depart = new Date(next);
    t = next;
    for (let n = 0; n < nights; n++) {
      day++;
      drivingPerDay.push(0);
    }
    dayDrive = 0;
  };

  legSeconds.forEach((secs, i) => {
    if (secs > maxDay) longLegs.push(i);
    const here = stops[stops.length - 1];
    const pref = points[i] ?? {};
    if (i > 0) {
      if (pref.overnight === true) {
        sleep(here, Math.max(1, Math.round(pref.nights ?? 1)), pref.departTime, false);
      } else if (autoOvernight && pref.overnight !== false && dayDrive > 0 && dayDrive + secs > maxDay) {
        sleep(here, 1, pref.departTime, true);
      }
    }
    t = new Date(t.getTime() + secs * 1000);
    dayDrive += secs;
    drivingPerDay[drivingPerDay.length - 1] += secs;
    const isLast = i === legSeconds.length - 1;
    const arrive = new Date(t);
    const stay = isLast ? 0 : Math.max(0, points[i + 1]?.stayMinutes ?? 0);
    t = new Date(t.getTime() + stay * 60_000);
    stops.push({ index: i + 1, arrive, depart: isLast ? null : new Date(t), day, overnight: false, auto: false, nights: 0 });
  });

  return {
    stops,
    days: day,
    drivingSeconds: legSeconds.reduce((a, b) => a + b, 0),
    drivingPerDay,
    longLegs,
    overLimitDays: drivingPerDay.map((d, i) => (d > maxDay ? i + 1 : 0)).filter(Boolean),
    arrival: stops[stops.length - 1].arrive ?? departure,
  };
}
