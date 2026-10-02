import {
  levelModeOf,
  limitMsOf,
  nearestMilestone,
  paceMsForWords,
  ringProgress,
  type LearnerStats,
  type Portion,
  type ReviewEntry,
  type Round,
  type RoundOutcome,
  type Settings,
  withDefaults,
} from "@instant-composition/domain";

import { toeicOf, type CatalogSnapshot } from "./catalog";
import type {
  AnsweredRow,
  DrillCard,
  LevelView,
  ReachView,
  RoundPayload,
  RoundSummary,
  ShownSettings,
} from "./views";

/** The level and its mode, named by the TOEIC reference the catalog gives it. */
export function levelViewOf(stats: LearnerStats, snapshot: CatalogSnapshot): LevelView {
  const level = stats.level?.level ?? null;
  return {
    mode: levelModeOf(stats),
    level,
    toeic: level === null ? null : toeicOf(snapshot, level),
  };
}

/** The settings as a client reads them, picked field by field for the reason `payloadOf` gives. */
export function shownSettingsOf(settings: Settings): ShownSettings {
  const shown = withDefaults(settings);
  const { topics, focus, dailySize, sound, limitSeconds, gradeKeys } = shown;
  const { vocabNewPerDay, vocabReviewsPerDay } = shown;
  return {
    ...{ topics, focus, dailySize, sound, limitSeconds, gradeKeys },
    ...{ vocabNewPerDay, vocabReviewsPerDay },
  };
}

/** A round's answers as a client reads them back. */
function answeredOf(reviews: readonly ReviewEntry[]): AnsweredRow[] {
  return reviews.map((review) => ({
    id: review.id,
    cardId: review.item.id,
    pass: review.detail.pass,
    result: review.detail.result,
    answeredAt: review.answeredAt,
  }));
}

/**
 * The round as the drill needs it: its cards with the limit the round was
 * dealt with and each card's pace, and where it stands.
 */
export function payloadOf(
  round: Round,
  reviews: readonly ReviewEntry[],
  portion: Portion | undefined,
  snapshot: CatalogSnapshot,
): RoundPayload {
  const cards: Record<string, DrillCard> = {};
  for (const id of round.deck) {
    const card = snapshot.shown.get(id);
    if (card !== undefined) {
      // Picked field by field: the response is not stripped to the contract, so a
      // spread would put every field a card gains, such as its concepts, on the wire.
      const { topic, subtopic, level, words, prompt, text, alternatives, explanation } =
        card;
      const paceMs = paceMsForWords(words);
      cards[id] = {
        id,
        topic,
        subtopic,
        level,
        words,
        prompt,
        text,
        alternatives,
        explanation,
        limitMs: limitMsOf(round, paceMs),
        paceMs,
      };
    }
  }
  const counted = round.kind !== "placement" && portion !== undefined;
  return {
    id: round.id,
    kind: round.kind,
    day: round.day,
    portionDay: round.portionDay,
    deck: round.deck,
    cards,
    answered: answeredOf(reviews),
    offset: counted ? portion.progress - round.firstPass : 0,
    total: counted ? portion.target : round.deck.length,
    retries: round.kind !== "placement",
  };
}

/** Mastered cards per chosen topic, with each ring and the nearest milestone. */
export function reachViewOf(
  reach: RoundOutcome["reach"],
  snapshot: CatalogSnapshot,
  pending: number | undefined,
): ReachView {
  const name = (topic: string): string =>
    snapshot.topics.find((info) => info.id === topic)?.name ?? topic;
  const nearest = nearestMilestone(
    new Map(reach.map((entry) => [entry.topic, entry.count])),
    reach.map((entry) => entry.topic),
  );
  return {
    topics: reach.map((entry) => ({
      id: entry.topic,
      name: name(entry.topic),
      count: entry.count,
      added: entry.added,
      ring: ringProgress(entry.count),
    })),
    nearest:
      nearest === undefined
        ? null
        : { name: name(nearest.topic), remaining: nearest.remaining },
    ...(pending === undefined ? {} : { pending }),
  };
}

/**
 * A finished round's end screen: its kept outcome, named from the catalog, and
 * its answers read from the log.
 */
export function summaryOf(
  round: Round,
  outcome: RoundOutcome,
  reviews: readonly ReviewEntry[],
  snapshot: CatalogSnapshot,
): RoundSummary {
  return {
    roundId: round.id,
    kind: round.kind,
    day: round.day,
    answered: answeredOf(reviews),
    yesterday: round.kind === "yesterday",
    placement:
      outcome.placement === null
        ? null
        : { ...outcome.placement, toeic: toeicOf(snapshot, outcome.placement.level) },
    difficulty:
      outcome.difficulty === null
        ? null
        : {
            change: outcome.difficulty.change,
            toeic: toeicOf(snapshot, outcome.difficulty.level),
          },
    growth: outcome.growth,
    review: outcome.review,
    streak: outcome.streak,
    week: outcome.week,
    filled: outcome.filled,
    reach: reachViewOf(outcome.reach, snapshot, outcome.pending),
    titles: outcome.titles,
    topicNames: Object.fromEntries(
      snapshot.topics.map((topic) => [topic.id, topic.name]),
    ),
    points: outcome.points,
    totals: outcome.totals,
    portionCompleted: outcome.portionCompleted,
    todayOpen: outcome.todayOpen,
    continueToday: outcome.continueToday,
  };
}
