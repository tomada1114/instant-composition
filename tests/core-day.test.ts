import { describe, expect, it } from "vitest";

import {
  addDays,
  calendarWeeks,
  dayDiff,
  dayOf,
  weekdayIndex,
  weekOf,
} from "../src/core/day";

/** Local wall-clock time, so the expectations hold in any timezone. */
function local(y: number, m: number, d: number, h: number, min = 0): number {
  return new Date(y, m - 1, d, h, min).getTime();
}

describe("dayOf", () => {
  it("counts 3:59 in the morning as the previous day", () => {
    expect(dayOf(local(2026, 9, 23, 3, 59))).toBe("2026-09-22");
  });

  it("starts the new day at 4:00", () => {
    expect(dayOf(local(2026, 9, 23, 4, 0))).toBe("2026-09-23");
  });

  it("keeps late evening on the same day", () => {
    expect(dayOf(local(2026, 9, 23, 23, 59))).toBe("2026-09-23");
  });

  it("crosses a month and a year boundary before 4:00", () => {
    expect(dayOf(local(2027, 1, 1, 2, 0))).toBe("2026-12-31");
  });
});

describe("day arithmetic", () => {
  it.each([
    ["2026-09-22", 1, "2026-09-23"],
    ["2026-09-30", 1, "2026-10-01"],
    ["2026-03-01", -1, "2026-02-28"],
    ["2028-03-01", -1, "2028-02-29"],
    ["2026-12-31", 30, "2027-01-30"],
  ])("adds to %s %p days giving %s", (day, n, expected) => {
    expect(addDays(day, n)).toBe(expected);
  });

  it("measures whole days between two keys", () => {
    expect(dayDiff("2026-09-22", "2026-10-02")).toBe(10);
    expect(dayDiff("2026-10-02", "2026-09-22")).toBe(-10);
  });

  it("numbers the weekday from Monday", () => {
    expect(weekdayIndex("2026-09-21")).toBe(0); // Monday
    expect(weekdayIndex("2026-09-27")).toBe(6); // Sunday
  });

  it("returns the Monday-to-Sunday week holding a day", () => {
    expect(weekOf("2026-09-23")).toStrictEqual([
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
    ]);
  });

  it("lays twelve weeks out oldest first, ending with the week of today", () => {
    const weeks = calendarWeeks("2026-09-23", 12);
    expect(weeks).toHaveLength(12);
    expect(weeks[11]?.[0]).toBe("2026-09-21");
    expect(weeks[0]?.[0]).toBe("2026-07-06");
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });
});
