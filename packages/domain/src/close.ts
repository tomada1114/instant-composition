import { addDays } from "./day";
import { settleLevel } from "./level";
import { reachByTopic } from "./mastery";
import { newTitles } from "./milestones";
import { roundPoints } from "./points";
import { emptyTally } from "./empty";
import type {
  DayTally,
  ItemProgress,
  LearnerStats,
  Portion,
  ReviewEntry,
  Round,
  RoundOutcome,
} from "./records";
import { growthOf } from "./round-growth";
import { streakStatus, weekDots, type CompletedDays } from "./streak";
import type { DayKey, SubtopicRef } from "./types";

/** The run shown for `day`; 0 stands for "day 1 from today" and is never displayed. */
export function streakValue(completed: CompletedDays, day: DayKey): number {
  const status = streakStatus(completed, day);
  return status.kind === "broken" ? 0 : status.current;
}

/** What the catalog contributes to closing a round. */
export interface CloseCatalog {
  /** Every topic id, in the taxonomy's order. */
  readonly topicOrder: readonly string[];
  /** The learner's chosen topics, in the taxonomy's order. */
  readonly chosen: readonly string[];
  /** Cards that exist and are shown now; growth compares only these. */
  readonly shown: ReadonlySet<string>;
  /** A card's placement from the card or its tombstone, when the catalog has either. */
  readonly placeOf: (cardId: string) => SubtopicRef | undefined;
}

export interface CloseState {
  readonly round: Round;
  readonly stats: LearnerStats;
  readonly portion: Portion | undefined;
  readonly day: DayTally | undefined;
  readonly items: ReadonlyMap<string, ItemProgress>;
  /** This round's reviews, in log order. */
  readonly reviews: readonly ReviewEntry[];
  /** The tallies of the fourteen days ending with the round's day. */
  readonly tallies: ReadonlyMap<DayKey, DayTally>;
  readonly catalog: CloseCatalog;
}

export interface CloseChange {
  readonly round: Round;
  readonly outcome: RoundOutcome;
  readonly stats: LearnerStats;
  /** The portion, when this round completed it. */
  readonly portion: Portion | undefined;
  readonly day: DayTally;
}

function reach(state: CloseState): {
  readonly before: Map<string, number>;
  readonly after: Map<string, number>;
} {
  const mastered = [...state.items.values()].filter((item) => item.mastered !== null);
  const where = new Map(
    mastered.map((item) => [
      item.item.id,
      state.catalog.placeOf(item.item.id) ?? item.placement,
    ]),
  );
  const ids = (items: readonly ItemProgress[]) => items.map((item) => item.item.id);
  return {
    after: reachByTopic(ids(mastered), where),
    before: reachByTopic(
      ids(mastered.filter((item) => item.mastered?.sessionId !== state.round.id)),
      where,
    ),
  };
}

/** Closes a round: everything its end screen shows, worked out once and kept. */
export function decideClose(state: CloseState, now: number): CloseChange {
  const { round, stats, catalog } = state;
  const day = round.day;
  const { portion } = state;
  const completedPortion =
    portion?.completedAt === null && portion.progress >= portion.target
      ? { ...portion, completedAt: now, completedRound: round.id }
      : undefined;
  const completing = completedPortion !== undefined;
  const before = new Set(stats.completedDays);
  const completedDays =
    completing && round.portionDay !== null
      ? [...stats.completedDays, round.portionDay]
      : stats.completedDays;
  const after = new Set(completedDays);
  const level = settleLevel(round, stats, state.reviews, now);
  const counts = reach(state);
  const streakBefore = streakValue(before, day);
  const streakAfter = streakValue(after, day);
  const titles = newTitles({
    streakBefore,
    streakAfter,
    reachBefore: counts.before,
    reachAfter: counts.after,
    topicOrder: catalog.topicOrder,
    awarded: new Set(stats.titles),
  });
  const earned = roundPoints(round.firstPass, completing);
  const shownOrder = new Map(round.deck.map((id, index) => [id, index]));
  const misses = state.reviews
    .filter((review) => review.detail.pass === "first" && review.detail.result !== "ok")
    .map((review) => ({ cardId: review.item.id, prompt: review.snapshot.prompt }));
  const outcome: RoundOutcome = {
    placement: level.placement,
    difficulty: level.difficulty,
    growth: growthOf(round.id, state.reviews, state.items, catalog.shown),
    review: misses.sort(
      (a, b) => (shownOrder.get(a.cardId) ?? 0) - (shownOrder.get(b.cardId) ?? 0),
    ),
    streak: { value: streakAfter, restart: streakAfter === 0, changed: completing },
    week: weekDots(after, day, stats.firstDay ?? undefined),
    filled: completing ? round.portionDay : null,
    reach: catalog.chosen.map((topic) => ({
      topic,
      count: counts.after.get(topic) ?? 0,
      added: (counts.after.get(topic) ?? 0) - (counts.before.get(topic) ?? 0),
    })),
    titles,
    points: { earned, total: stats.points + earned },
    totals: {
      said: stats.said,
      practicedDays: stats.practicedDays,
      last14: Array.from({ length: 14 }, (_, index) => {
        const at = addDays(day, index - 13);
        return { day: at, count: state.tallies.get(at)?.answers ?? 0 };
      }),
      added: state.reviews.length,
    },
    portionCompleted: completing,
    todayOpen: round.kind === "yesterday" && !after.has(day),
    continueToday:
      round.kind === "placement" && round.portionDay === day && !after.has(day),
  };
  const tally = state.day ?? emptyTally(day);
  return {
    round: { ...round, finishedAt: now, outcome },
    outcome,
    stats: {
      ...stats,
      points: stats.points + earned,
      completedDays,
      level: level.entry ?? stats.level,
      levelWindow: level.entry === null ? stats.levelWindow : [],
      titles: [...stats.titles, ...titles],
      openRound: stats.openRound?.id === round.id ? null : stats.openRound,
    },
    portion: completedPortion,
    day: {
      ...tally,
      roundsFinished: tally.roundsFinished + 1,
      lastFinishedRound: round.id,
    },
  };
}
