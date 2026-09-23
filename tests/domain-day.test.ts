import { describe, expect, it, vi } from "vitest";

import {
  addDays,
  calendarWeeks,
  dayDiff,
  dayOf,
  weekdayIndex,
  weekOf,
} from "@instant-composition/domain";

/** An instant written as UTC, so the expectations name no process time zone. */
function utc(y: number, m: number, d: number, h: number, min = 0): number {
  return Date.UTC(y, m - 1, d, h, min);
}

describe("dayOf", () => {
  // Tokyo is UTC+9 all year, so 18:59 UTC is 3:59 the next morning there.
  it("counts 3:59 in the morning as the previous day", () => {
    expect(dayOf(utc(2026, 9, 22, 18, 59), "Asia/Tokyo")).toBe("2026-09-22");
  });

  it("starts the new day at 4:00", () => {
    expect(dayOf(utc(2026, 9, 22, 19, 0), "Asia/Tokyo")).toBe("2026-09-23");
  });

  it("keeps late evening on the same day", () => {
    expect(dayOf(utc(2026, 9, 23, 14, 59), "Asia/Tokyo")).toBe("2026-09-23");
  });

  it("crosses a month and a year boundary before 4:00", () => {
    expect(dayOf(utc(2026, 12, 31, 17, 0), "Asia/Tokyo")).toBe("2026-12-31");
  });

  it("puts one instant on the day of the learner's own zone", () => {
    const instant = utc(2026, 9, 23, 2, 0);
    expect(dayOf(instant, "Asia/Tokyo")).toBe("2026-09-23");
    expect(dayOf(instant, "UTC")).toBe("2026-09-22");
    expect(dayOf(instant, "America/Los_Angeles")).toBe("2026-09-22");
  });

  it("reads the boundary off the wall clock on both sides of a DST change", () => {
    // New York moves from UTC-5 to UTC-4 at 2:00 on 2027-03-14.
    expect(dayOf(utc(2027, 3, 14, 7, 59), "America/New_York")).toBe("2027-03-13");
    expect(dayOf(utc(2027, 3, 14, 8, 0), "America/New_York")).toBe("2027-03-14");
  });

  it("takes a boundary hour other than the default", () => {
    expect(dayOf(utc(2026, 9, 22, 20, 0), "Asia/Tokyo", 6)).toBe("2026-09-22");
    expect(dayOf(utc(2026, 9, 22, 15, 0), "Asia/Tokyo", 0)).toBe("2026-09-23");
  });

  it("refuses a zone that is not an IANA name", () => {
    expect(() => dayOf(0, "Mars/Olympus_Mons")).toThrow(RangeError);
  });
});

describe("dayOf under different process time zones", () => {
  const instants = [
    utc(2026, 9, 22, 18, 59),
    utc(2026, 9, 22, 19, 0),
    utc(2026, 12, 31, 17, 0),
    utc(2027, 3, 14, 7, 59),
    utc(2027, 3, 14, 8, 0),
  ];
  const zones = ["Asia/Tokyo", "UTC", "America/New_York"];

  function daysUnder(processZone: string): { hours: number[]; days: string[] } {
    vi.stubEnv("TZ", processZone);
    return {
      hours: instants.map((instant) => new Date(instant).getHours()),
      days: zones.flatMap((zone) => instants.map((instant) => dayOf(instant, zone))),
    };
  }

  it("derives identical days whether the process runs in UTC or in Tokyo", () => {
    const underUtc = daysUnder("UTC");
    const underTokyo = daysUnder("Asia/Tokyo");

    // The process zone really changed, or the comparison below proves nothing.
    expect(underTokyo.hours).not.toStrictEqual(underUtc.hours);
    expect(underTokyo.days).toStrictEqual(underUtc.days);
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
