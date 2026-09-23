import {
  addDays,
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
import type { Write } from "./execute";
import { itemValues, statsOf } from "./practice";
import { summaryOf } from "./present";
import type { LearnerStore, Stored } from "./store";
import type { RoundSummary } from "./views";

/** What closing a round reads beyond the round itself. */
export interface CloseLoad {
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
  return { round, stats, items, reviews, portion, tallies };
}

export interface ClosePlan {
  readonly summary: RoundSummary;
  readonly stats: LearnerStats;
  readonly writes: readonly Write[];
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
  const change = decideClose(
    {
      round,
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
    [{ type: "round", value: finished }, load.round],
    [{ type: "stats", value: change.stats }, load.stats],
    [{ type: "day", value: change.day }, load.tallies.get(round.day)],
  ];
  const kept = change.portion ?? portion;
  if (kept !== undefined) {
    writes.push([{ type: "portion", value: kept }, load.portion]);
  }
  return {
    summary: summaryOf(finished, change.outcome, snapshot),
    stats: change.stats,
    writes,
  };
}
