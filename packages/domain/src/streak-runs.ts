import { addDays, dayDiff } from "./day";
import type { LearnerStats } from "./records";
import type { StreakStatus } from "./streak";
import type { DayKey } from "./types";

/** A maximal contiguous interval of completed credit days. */
export interface StreakRun {
  readonly schema: 1;
  readonly start: DayKey;
  readonly end: DayKey;
}

/** Compact totals. Legacy completedDays is read only by explicit maintenance. */
export function compactStats(stats: LearnerStats, longest: number): LearnerStats {
  return {
    points: stats.points,
    firstDay: stats.firstDay,
    said: stats.said,
    practicedDays: stats.practicedDays,
    level: stats.level,
    levelWindow: stats.levelWindow,
    openRound: stats.openRound,
    titles: stats.titles,
    ...(stats.levelMode === undefined ? {} : { levelMode: stats.levelMode }),
    streak: { schema: 1, longest },
  };
}

export function streakFromRuns(
  today: DayKey,
  runs: readonly StreakRun[],
  longest: number,
): StreakStatus {
  const runAt = (day: DayKey): number => {
    const run = runs.find(
      (candidate) => candidate.start <= day && candidate.end >= day,
    );
    return run === undefined ? 0 : dayDiff(run.start, day) + 1;
  };
  const current = runAt(today);
  const yesterday = runAt(addDays(today, -1));
  const before = runAt(addDays(today, -2));
  if (current > 0) {
    return {
      kind: "done",
      current,
      restoresTo: yesterday === 0 && before > 0 ? before + 2 : null,
    };
  }
  if (yesterday > 0) return { kind: "alive", current: yesterday };
  if (before > 0) return { kind: "gap", current: before };
  return { kind: "broken", longest };
}

/** Joining an arbitrary late credit needs at most its two neighbouring intervals. */
export function joinStreakRun(
  day: DayKey,
  neighbours: readonly StreakRun[],
): { readonly run: StreakRun; readonly replaced: readonly StreakRun[] } {
  const containing = neighbours.find((run) => run.start <= day && run.end >= day);
  if (containing !== undefined) return { run: containing, replaced: [] };
  const left = neighbours.find((run) => run.end === addDays(day, -1));
  const right = neighbours.find((run) => run.start === addDays(day, 1));
  return {
    run: { schema: 1, start: left?.start ?? day, end: right?.end ?? day },
    replaced: [left, right].filter((run): run is StreakRun => run !== undefined),
  };
}
