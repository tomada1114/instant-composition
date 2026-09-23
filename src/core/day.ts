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

/**
 * The practice day an instant belongs to: its local date after taking off the
 * boundary hours, so a late night still counts toward the day it started in.
 */
export function dayOf(
  epochMs: number,
  boundaryHour: number = TUNING.dayBoundaryHour,
): DayKey {
  const shifted = new Date(epochMs);
  shifted.setHours(shifted.getHours() - boundaryHour);
  return `${String(shifted.getFullYear())}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
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
