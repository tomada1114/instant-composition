import { TUNING } from "./tuning";
import type { DayKey } from "./types";

const MS_PER_DAY = 86_400_000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Midnight UTC of a key: day arithmetic runs in UTC so no DST shift can skip a day. */
function utcMs(day: DayKey): number {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date);
}

function fromUtcMs(ms: number): DayKey {
  const date = new Date(ms);
  return `${String(date.getUTCFullYear())}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** The calendar date and hour an instant reads as on a wall clock in `timeZone`. */
function wallClock(
  epochMs: number,
  timeZone: string,
): { readonly day: DayKey; readonly hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(epochMs);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return {
    day: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
  };
}

/**
 * The practice day an instant belongs to: its date on the learner's wall clock,
 * or the date before while that clock still reads earlier than the boundary
 * hour, so a late night counts toward the day it started in.
 *
 * @param timeZone - The learner's IANA time zone, such as `Asia/Tokyo`. The
 * process's own zone is never read, so every host derives the same day. An
 * unknown zone throws a `RangeError`: it is validated where it enters.
 */
export function dayOf(
  epochMs: number,
  timeZone: string,
  boundaryHour: number = TUNING.dayBoundaryHour,
): DayKey {
  const { day, hour } = wallClock(epochMs, timeZone);
  return hour < boundaryHour ? addDays(day, -1) : day;
}

export function addDays(day: DayKey, days: number): DayKey {
  return fromUtcMs(utcMs(day) + days * MS_PER_DAY);
}

/** `to - from` in whole days. */
export function dayDiff(from: DayKey, to: DayKey): number {
  return Math.round((utcMs(to) - utcMs(from)) / MS_PER_DAY);
}

/** 0 for Monday through 6 for Sunday. */
export function weekdayIndex(day: DayKey): number {
  return (new Date(utcMs(day)).getUTCDay() + 6) % 7;
}

/** The Monday-to-Sunday week that holds `day`. */
export function weekOf(day: DayKey): DayKey[] {
  const monday = addDays(day, -weekdayIndex(day));
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

/** `weeks` Monday-to-Sunday weeks, oldest first, the last one holding `today`. */
export function calendarWeeks(today: DayKey, weeks: number): DayKey[][] {
  const lastMonday = addDays(today, -weekdayIndex(today));
  return Array.from({ length: weeks }, (_, index) =>
    weekOf(addDays(lastMonday, (index - weeks + 1) * 7)),
  );
}
