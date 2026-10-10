import { describe, expect, it } from "vitest";
import { buildSchedule, type SchedulePoint } from "../shared/schedule";

const H = 3600;
const pts = (n: number, extra: Record<number, SchedulePoint> = {}): SchedulePoint[] =>
  Array.from({ length: n }, (_, i) => extra[i] ?? {});

describe("schedule", () => {
  const dep = new Date(2026, 11, 16, 7, 0); // 16 Dec 2026 07:00 local

  it("adds stay time and arrives on the same day", () => {
    const s = buildSchedule(dep, [H, 2 * H], pts(3, { 1: { stayMinutes: 30 } }), 8);
    expect(s.days).toBe(1);
    expect(s.stops[1].arrive!.getHours()).toBe(8);
    expect(s.stops[1].depart!.getMinutes()).toBe(30);
    expect(s.arrival.getHours()).toBe(10);
    expect(s.arrival.getMinutes()).toBe(30);
  });

  it("inserts overnight stops automatically when the daily limit is exceeded", () => {
    // three 4-hour legs with an 8 hour limit: drive 8h day 1, sleep, drive 4h day 2
    const s = buildSchedule(dep, [4 * H, 4 * H, 4 * H], pts(4), 8);
    expect(s.days).toBe(2);
    expect(s.stops[2]).toMatchObject({ overnight: true, auto: true, nights: 1 });
    expect(s.stops[2].depart!.getDate()).toBe(17);
    expect(s.stops[2].depart!.getHours()).toBe(7);
    expect(s.stops[3].arrive!.getHours()).toBe(11);
    expect(s.stops[3].day).toBe(2);
    expect(s.drivingPerDay).toEqual([8 * H, 4 * H]);
  });

  it("flags legs longer than a day's driving", () => {
    const s = buildSchedule(dep, [10 * H], pts(2), 8);
    expect(s.longLegs).toEqual([0]);
    expect(s.overLimitDays).toEqual([1]);
    expect(s.days).toBe(1);
  });

  it("sleeps where the traveller chooses, and the automatic stops adapt", () => {
    // without overrides the night would be at point 2; force it at point 1 instead
    const s = buildSchedule(dep, [3 * H, 4 * H, 4 * H], pts(4, { 1: { overnight: true } }), 8);
    expect(s.stops[1]).toMatchObject({ overnight: true, auto: false });
    expect(s.stops[2].overnight).toBe(false); // 4 + 4 = 8h on day 2 fits the limit
    expect(s.days).toBe(2);
    expect(s.drivingPerDay).toEqual([3 * H, 8 * H]);
  });

  it("never sleeps automatically where the traveller said not to", () => {
    const s = buildSchedule(dep, [4 * H, 4 * H, 4 * H], pts(4, { 2: { overnight: false } }), 8);
    expect(s.stops.some((x) => x.overnight)).toBe(false);
    expect(s.overLimitDays).toEqual([1]);
  });

  it("supports several nights and a custom departure time", () => {
    const s = buildSchedule(dep, [2 * H, 2 * H], pts(3, { 1: { overnight: true, nights: 2, departTime: "10:30" } }), 8);
    expect(s.stops[1].nights).toBe(2);
    expect(s.stops[1].depart!.getDate()).toBe(18);
    expect(s.stops[1].depart!.getHours()).toBe(10);
    expect(s.stops[1].depart!.getMinutes()).toBe(30);
    expect(s.days).toBe(3);
    expect(s.stops[2].day).toBe(3);
    expect(s.drivingPerDay).toEqual([2 * H, 0, 2 * H]);
  });

  it("can turn automatic overnights off entirely", () => {
    const s = buildSchedule(dep, [6 * H, 6 * H], pts(3), 8, false);
    expect(s.days).toBe(1);
    expect(s.overLimitDays).toEqual([1]);
  });

  it("handles arriving after midnight", () => {
    const late = new Date(2026, 11, 16, 20, 0);
    const s = buildSchedule(late, [5 * H, 2 * H], pts(3, { 1: { overnight: true, departTime: "09:00" } }), 12);
    // arrive 01:00 on the 17th, leave 09:00 the same morning
    expect(s.stops[1].arrive!.getDate()).toBe(17);
    expect(s.stops[1].depart!.getDate()).toBe(17);
    expect(s.stops[1].depart!.getHours()).toBe(9);
  });
});
