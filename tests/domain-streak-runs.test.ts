import { describe, expect, it } from "vitest";
import {
  addDays,
  joinStreakRun,
  longestRun,
  streakFromRuns,
  streakStatus,
  type StreakRun,
} from "@instant-composition/domain";

function intervals(days: readonly string[]): StreakRun[] {
  let runs: StreakRun[] = [];
  for (const day of days) {
    const neighbours = runs
      .filter((run) => run.start <= day)
      .slice(-1)
      .concat(runs.find((run) => run.start > day) ?? []);
    const joined = joinStreakRun(day, neighbours);
    runs = [
      ...runs.filter(
        (run) =>
          !joined.replaced.some((old) => old.start === run.start) &&
          run.start !== joined.run.start,
      ),
      joined.run,
    ].sort((a, b) => a.start.localeCompare(b.start));
  }
  return runs;
}

describe("compact exact streak intervals", () => {
  it("matches the full completed-day planner before and after arbitrary late credits join two runs", () => {
    const all = Array.from({ length: 1100 }, (_, at) => addDays("2020-01-01", at));
    const ordered = [
      ...all.filter((_, at) => at % 11 !== 0),
      ...all.filter((_, at) => at % 11 === 0).reverse(),
    ];
    const completed = new Set<string>();
    let runs: StreakRun[] = [];
    let longest = 0;
    for (const day of ordered) {
      const neighbours = runs
        .filter((run) => run.start <= day)
        .slice(-1)
        .concat(runs.find((run) => run.start > day) ?? []);
      const joined = joinStreakRun(day, neighbours);
      runs = [
        ...runs.filter(
          (run) =>
            !joined.replaced.some((old) => old.start === run.start) &&
            run.start !== joined.run.start,
        ),
        joined.run,
      ].sort((a, b) => a.start.localeCompare(b.start));
      longest = Math.max(
        longest,
        all.indexOf(joined.run.end) - all.indexOf(joined.run.start) + 1,
      );
      completed.add(day);
      for (const today of [day, addDays(day, 1), addDays(day, 2), all.at(-1) ?? day])
        expect(streakFromRuns(today, runs, longest)).toStrictEqual(
          streakStatus(completed, today),
        );
    }
    expect(runs).toStrictEqual([{ schema: 1, start: "2020-01-01", end: all.at(-1) }]);
    expect(longest).toBe(longestRun(completed));
  });
  it("keeps a completed today and recoverable yesterday exact across a long historical run", () => {
    const today = "2026-09-22";
    const prior = Array.from({ length: 400 }, (_, at) => addDays(today, at - 401));
    const days = [...prior, today];
    const runs = intervals(days);
    expect(streakFromRuns(today, runs, 400)).toStrictEqual({
      kind: "done",
      current: 1,
      restoresTo: 402,
    });
    const joined = joinStreakRun(addDays(today, -1), runs);
    expect(streakFromRuns(today, [joined.run], 402)).toStrictEqual({
      kind: "done",
      current: 402,
      restoresTo: null,
    });
    expect(joined.replaced).toHaveLength(2);
  });
  it("does not rewrite an already completed credit", () => {
    const run: StreakRun = { schema: 1, start: "2026-01-01", end: "2026-12-31" };
    expect(joinStreakRun("2026-09-22", [run])).toStrictEqual({ run, replaced: [] });
  });
});
