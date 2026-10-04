import {
  addDays,
  weekOf,
  streakFromRuns,
  type StreakRun,
  decideClose,
  type DayKey,
  type DayTally,
  type ItemProgress,
  type LearnerStats,
  type Portion,
  type ReviewEntry,
  type Round,
} from "@instant-composition/domain";

import { placeOf, type CatalogSnapshot } from "./catalog";
import type { Write, Removal } from "./execute";
import { itemValues, statsOf } from "./practice";
import { summaryOf } from "./present";
import type { LearnerStore, Stored } from "./store";
import { completionPlan, loadStreakStatus } from "./streak-maintenance";
import type { RoundSummary } from "./views";

/** What closing a round reads beyond the round itself. */
export interface CloseLoad {
  readonly statusRuns: readonly Stored<StreakRun>[];
  readonly completed: ReadonlySet<DayKey>;
  readonly neighbours: readonly Stored<StreakRun>[];
  readonly streak: Awaited<ReturnType<typeof loadStreakStatus>>;
  readonly round: Stored<Round>;
  readonly stats: Stored<LearnerStats> | undefined;
  readonly items: ReadonlyMap<string, Stored<ItemProgress>>;
  readonly reviews: readonly ReviewEntry[];
  readonly portion: Stored<Portion> | undefined;
  readonly tallies: ReadonlyMap<DayKey, Stored<DayTally>>;
}

export async function loadClose(
  store: LearnerStore,
  round: Stored<Round>,
): Promise<CloseLoad> {
  const { day, portionDay } = round.value;
  const [stats, items, reviews, portion, tallies] = await Promise.all([
    store.stats(),
    store.items(),
    store.reviewsOf(round.value.id),
    portionDay === null ? undefined : store.portion(portionDay),
    store.days(Array.from({ length: 14 }, (_, index) => addDays(day, index - 13))),
  ]);
  const [calendar, neighbours, streak, near, before] = await Promise.all([
    store.portionsPage({
      from: addDays(weekOf(day)[0] ?? day, -2),
      to: day,
      limit: 12,
    }),
    store.streakNeighbours(portionDay ?? day),
    loadStreakStatus(store, day, stats?.value.streak?.longest ?? 0),
    store.streakNeighbours(day),
    store.streakNeighbours(addDays(day, -2)),
  ]);
  return {
    round,
    stats,
    items,
    reviews,
    portion,
    tallies,
    completed: new Set(
      calendar.entries
        .filter(({ value }) => value.completedAt !== null)
        .map(({ value }) => value.day),
    ),
    neighbours,
    streak,
    statusRuns: [...near, ...before],
  };
}

export interface ClosePlan {
  readonly summary: RoundSummary;
  readonly stats: LearnerStats;
  readonly writes: readonly Write[];
  readonly deletes: readonly Removal[];
}

/**
 * Closes the loaded round. `portion` stands in for the stored portion when the
 * same commit changes it first, as a lowered daily size does.
 */
export function planClose(
  load: CloseLoad,
  snapshot: CatalogSnapshot,
  chosen: readonly string[],
  now: number,
  portion?: Portion,
): ClosePlan {
  const round = load.round.value;
  const keptPortion = portion ?? load.portion?.value;
  const completing =
    keptPortion?.completedAt === null &&
    keptPortion.progress >= keptPortion.target &&
    round.portionDay !== null;
  const completion = completing
    ? completionPlan(load.neighbours, round.portionDay, statsOf(load))
    : undefined;
  const afterRuns = [
    ...load.statusRuns
      .map(({ value }) => value)
      .filter(
        (run) =>
          !(
            completion?.writes.some(
              ([entry]) =>
                entry.type === "streakRun" && entry.value.start === run.start,
            ) ?? false
          ) &&
          !(
            completion?.deletes.some(
              ({ key }) => key.type === "streakRun" && key.start === run.start,
            ) ?? false
          ),
      ),
    ...(completion?.runs ?? []),
  ];
  const change = decideClose(
    {
      round,
      completed: load.completed,
      streakBefore: load.streak,
      streakAfter:
        completion === undefined
          ? load.streak
          : streakFromRuns(round.day, afterRuns, completion.stats.streak?.longest ?? 0),
      longestAfter:
        completion?.stats.streak?.longest ?? statsOf(load).streak?.longest ?? 0,
      stats: statsOf(load),
      portion: portion ?? load.portion?.value,
      day: load.tallies.get(round.day)?.value,
      items: itemValues(load.items),
      reviews: load.reviews,
      tallies: new Map([...load.tallies].map(([day, tally]) => [day, tally.value])),
      catalog: {
        topicOrder: snapshot.topics.map((topic) => topic.id),
        chosen: snapshot.topics
          .map((topic) => topic.id)
          .filter((id) => chosen.includes(id)),
        shown: new Set(snapshot.shown.keys()),
        placeOf: placeOf(snapshot),
      },
    },
    now,
  );
  const finished = change.round;
  const writes: Write[] = [
    ...(completion?.writes ?? []),
    [{ type: "round", value: finished }, load.round],
    [{ type: "stats", value: change.stats }, load.stats],
    [{ type: "day", value: change.day }, load.tallies.get(round.day)],
  ];
  const kept = change.portion ?? portion;
  if (kept !== undefined) {
    writes.push([{ type: "portion", value: kept }, load.portion]);
  }
  return {
    summary: summaryOf(finished, change.outcome, load.reviews, snapshot),
    stats: change.stats,
    writes,
    deletes: completion?.deletes ?? [],
  };
}
