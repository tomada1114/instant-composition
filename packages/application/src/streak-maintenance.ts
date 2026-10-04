import {
  addDays,
  compactStats,
  dayDiff,
  joinStreakRun,
  streakFromRuns,
  type DayKey,
  type LearnerStats,
  type StreakRun,
  type StreakStatus,
} from "@instant-composition/domain";
import type { Removal, Write } from "./execute";
import type { LearnerStore, Stored } from "./store";

export async function loadStreakStatus(
  store: LearnerStore,
  day: DayKey,
  longest: number,
): Promise<StreakStatus> {
  const [near, before] = await Promise.all([
    store.streakNeighbours(day),
    store.streakNeighbours(addDays(day, -2)),
  ]);
  return streakFromRuns(
    day,
    [...near, ...before].map((run) => run.value),
    longest,
  );
}
export function completionPlan(
  neighbours: readonly Stored<StreakRun>[],
  day: DayKey,
  stats: LearnerStats,
): {
  readonly stats: LearnerStats;
  readonly writes: readonly Write[];
  readonly deletes: readonly Removal[];
  readonly runs: readonly StreakRun[];
} {
  const joined = joinStreakRun(
    day,
    neighbours.map((run) => run.value),
  );
  const unchanged = neighbours.find(
    (run) => run.value.start === joined.run.start && run.value.end === joined.run.end,
  );
  const existing = neighbours.find((run) => run.value.start === joined.run.start);
  const writes: Write[] =
    unchanged === undefined
      ? [[{ type: "streakRun", value: joined.run }, existing]]
      : [];
  const deletes = neighbours
    .filter(
      (run) =>
        joined.replaced.some((replaced) => replaced.start === run.value.start) &&
        run.value.start !== joined.run.start,
    )
    .map((run) => ({
      key: { type: "streakRun" as const, start: run.value.start },
      version: run.version,
    }));
  return {
    stats: compactStats(
      stats,
      Math.max(
        stats.streak?.longest ?? 0,
        dayDiff(joined.run.start, joined.run.end) + 1,
      ),
    ),
    writes,
    deletes,
    runs: [joined.run],
  };
}
