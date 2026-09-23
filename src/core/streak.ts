import { addDays, calendarWeeks, weekOf } from "./day";
import type { DayKey } from "./types";

/** Completed days: every credit day whose portion was finished. */
export type CompletedDays = ReadonlySet<DayKey>;

/** Consecutive completed days counting back from `day`, 0 when `day` is open. */
export function runEndingAt(completed: CompletedDays, day: DayKey): number {
  let run = 0;
  while (completed.has(addDays(day, -run))) {
    run += 1;
  }
  return run;
}

export function longestRun(completed: CompletedDays): number {
  let longest = 0;
  for (const day of completed) {
    if (!completed.has(addDays(day, 1))) {
      longest = Math.max(longest, runEndingAt(completed, day));
    }
  }
  return longest;
}

/** Yesterday is open and the day before it completed, so yesterday can still be made up. */
export function isYesterdayRecoverable(
  completed: CompletedDays,
  today: DayKey,
): boolean {
  return !completed.has(addDays(today, -1)) && completed.has(addDays(today, -2));
}

export type StreakStatus =
  /** Today is completed; `restoresTo` is what making up yesterday would give. */
  | {
      readonly kind: "done";
      readonly current: number;
      readonly restoresTo: number | null;
    }
  /** Today is open and yesterday completed. */
  | { readonly kind: "alive"; readonly current: number }
  /** Today and yesterday are open; the run to the day before can still be kept. */
  | { readonly kind: "gap"; readonly current: number }
  /** Nothing to carry: shown as "day 1 from today", never as 0. */
  | { readonly kind: "broken"; readonly longest: number };

export function streakStatus(completed: CompletedDays, today: DayKey): StreakStatus {
  const yesterday = addDays(today, -1);
  const dayBefore = addDays(today, -2);
  if (completed.has(today)) {
    return {
      kind: "done",
      current: runEndingAt(completed, today),
      restoresTo: isYesterdayRecoverable(completed, today)
        ? runEndingAt(completed, dayBefore) + 2
        : null,
    };
  }
  if (completed.has(yesterday)) {
    return { kind: "alive", current: runEndingAt(completed, yesterday) };
  }
  if (completed.has(dayBefore)) {
    return { kind: "gap", current: runEndingAt(completed, dayBefore) };
  }
  return { kind: "broken", longest: longestRun(completed) };
}

export type DotState = "done" | "gap" | "missed" | "upcoming";

export interface Dot {
  readonly day: DayKey;
  readonly state: DotState;
}

function dotState(
  completed: CompletedDays,
  today: DayKey,
  firstDay: DayKey | undefined,
  day: DayKey,
): DotState {
  if (day > today) {
    return "upcoming";
  }
  if (completed.has(day)) {
    return "done";
  }
  if (day === today) {
    return "upcoming";
  }
  if (day === addDays(today, -1) && isYesterdayRecoverable(completed, today)) {
    return "gap";
  }
  if (firstDay === undefined || day < firstDay) {
    return "upcoming";
  }
  return "missed";
}

/** Monday to Sunday of the week holding `today`. */
export function weekDots(
  completed: CompletedDays,
  today: DayKey,
  firstDay: DayKey | undefined,
): Dot[] {
  return weekOf(today).map((day) => ({
    day,
    state: dotState(completed, today, firstDay, day),
  }));
}

/** The records screen's calendar: `weeks` columns, oldest first. */
export function calendarDots(
  completed: CompletedDays,
  today: DayKey,
  firstDay: DayKey | undefined,
  weeks = 12,
): Dot[][] {
  return calendarWeeks(today, weeks).map((week) =>
    week.map((day) => ({ day, state: dotState(completed, today, firstDay, day) })),
  );
}
