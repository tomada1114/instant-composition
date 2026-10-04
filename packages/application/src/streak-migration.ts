import {
  addDays,
  compactStats,
  dayDiff,
  type LearnerStats,
  type StreakRun,
} from "@instant-composition/domain";
import { commitOf, type Removal, type Write } from "./execute";
import { compositionSchemaSupported } from "./composition-model";
import type { LearnerStore, Stored } from "./store";

/** Explicit paged legacy conversion, driven by maintenance, never by GET. */
export async function migrateStreakStep(
  store: LearnerStore,
  stats: Stored<LearnerStats>,
): Promise<boolean> {
  if (stats.value.streak !== undefined) return true;
  const stored = await store.streakMigration();
  if (stored !== undefined && !compositionSchemaSupported(stored.value)) return false;
  if (stored !== undefined && stored.value.statsVersion !== stats.version) {
    const partial = (await store.streakNeighbours("0000-00-00"))[0];
    await store.commit(
      commitOf(
        partial === undefined
          ? [
              [
                {
                  type: "streakMigration",
                  value: {
                    schema: 1,
                    statsVersion: stats.version,
                    legacyCursor:
                      (stats.value.completedDays?.length ?? 0) > 0 ? 0 : null,
                    cursor: null,
                    open: null,
                    longest: 0,
                  },
                },
                stored,
              ],
            ]
          : [],
        partial === undefined
          ? []
          : [
              {
                key: { type: "streakRun", start: partial.value.start },
                version: partial.version,
              },
            ],
        [
          { key: { type: "stats" }, version: stats.version },
          ...(partial === undefined
            ? []
            : [{ key: { type: "streakMigration" as const }, version: stored.version }]),
        ],
      ),
    );
    return false;
  }
  const checkpoint = stored?.value ?? {
    schema: 1 as const,
    statsVersion: stats.version,
    legacyCursor: (stats.value.completedDays?.length ?? 0) > 0 ? 0 : null,
    cursor: null,
    open: null,
    longest: 0,
  };
  if (checkpoint.legacyCursor !== null) {
    const days = [...new Set(stats.value.completedDays ?? [])].slice(
      checkpoint.legacyCursor,
      checkpoint.legacyCursor + 40,
    );
    const portions = await Promise.all(days.map((day) => store.portion(day)));
    const writes: Write[] = portions.flatMap((portion, index): Write[] => {
      const day = days[index];
      return portion !== undefined || day === undefined
        ? []
        : [
            [
              {
                type: "portion",
                value: {
                  day,
                  target: 0,
                  progress: 0,
                  completedAt: 0,
                  completedRound: "legacy-migration",
                },
              },
              undefined,
            ],
          ];
    });
    const next = checkpoint.legacyCursor + days.length;
    writes.push([
      {
        type: "streakMigration",
        value: {
          ...checkpoint,
          legacyCursor:
            next >= new Set(stats.value.completedDays ?? []).size ? null : next,
        },
      },
      stored,
    ]);
    await store.commit(
      commitOf(writes, [], [{ key: { type: "stats" }, version: stats.version }]),
    );
    return false;
  }
  const page = await store.portionsPage({
    from: "0000-00-00",
    to: "9999-99-99",
    limit: 40,
    ...(checkpoint.cursor === null ? {} : { cursor: checkpoint.cursor }),
  });
  let open = checkpoint.open;
  let longest = checkpoint.longest;
  const runs: StreakRun[] = [];
  for (const { value: portion } of page.entries) {
    if (portion.completedAt === null) continue;
    if (open === null) open = { schema: 1, start: portion.day, end: portion.day };
    else if (portion.day === addDays(open.end, 1)) open = { ...open, end: portion.day };
    else {
      runs.push(open);
      open = { schema: 1, start: portion.day, end: portion.day };
    }
    longest = Math.max(longest, dayDiff(open.start, open.end) + 1);
  }
  if (page.cursor === null && open !== null) runs.push(open);
  const writes: Write[] = runs.map((run) => [
    { type: "streakRun", value: run },
    undefined,
  ]);
  const deletes: Removal[] = [];
  if (page.cursor === null) {
    writes.push([{ type: "stats", value: compactStats(stats.value, longest) }, stats]);
    if (stored !== undefined)
      deletes.push({ key: { type: "streakMigration" }, version: stored.version });
  } else {
    writes.push([
      {
        type: "streakMigration",
        value: { ...checkpoint, cursor: page.cursor, open, longest },
      },
      stored,
    ]);
  }
  const result = await store.commit(
    commitOf(
      writes,
      deletes,
      page.cursor === null ? [] : [{ key: { type: "stats" }, version: stats.version }],
    ),
  );
  return result.ok && page.cursor === null;
}
