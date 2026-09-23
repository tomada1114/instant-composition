import {
  limitMsForWords,
  nearestMilestone,
  ringProgress,
  type Portion,
  type ReviewEntry,
  type Round,
  type RoundOutcome,
} from "@instant-composition/domain";

import { toeicOf, type CatalogSnapshot } from "./catalog";
import type { DrillCard, ReachView, RoundPayload, RoundSummary } from "./views";

/** The round as the drill needs it: its cards with their limits, and where it stands. */
export function payloadOf(
  round: Round,
  reviews: readonly ReviewEntry[],
  portion: Portion | undefined,
  snapshot: CatalogSnapshot,
): RoundPayload {
  const cards: Record<string, DrillCard> = {};
  for (const id of round.deck) {
    const card = snapshot.known.get(id);
    if (card !== undefined) {
      cards[id] = { ...card, limitMs: limitMsForWords(card.words) };
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
    answered: reviews.map((review) => ({
      cardId: review.item.id,
      pass: review.detail.pass,
      result: review.detail.result,
    })),
    offset: counted ? portion.progress - round.firstPass : 0,
    total: counted ? portion.target : round.deck.length,
    retries: round.kind !== "placement",
  };
}

/** Mastered cards per chosen topic, with each ring and the nearest milestone. */
export function reachViewOf(
  reach: RoundOutcome["reach"],
  snapshot: CatalogSnapshot,
): ReachView {
  const name = (topic: string): string =>
    snapshot.topics.find((info) => info.id === topic)?.ja ?? topic;
  const nearest = nearestMilestone(
    new Map(reach.map((entry) => [entry.topic, entry.count])),
    reach.map((entry) => entry.topic),
  );
  return {
    topics: reach.map((entry) => ({
      id: entry.topic,
      ja: name(entry.topic),
      count: entry.count,
      added: entry.added,
      ring: ringProgress(entry.count),
    })),
    nearest:
      nearest === undefined
        ? null
        : { ja: name(nearest.topic), remaining: nearest.remaining },
  };
}

/** A finished round's end screen: its kept outcome, named from the catalog. */
export function summaryOf(
  round: Round,
  outcome: RoundOutcome,
  snapshot: CatalogSnapshot,
): RoundSummary {
  return {
    roundId: round.id,
    kind: round.kind,
    day: round.day,
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
    reach: reachViewOf(outcome.reach, snapshot),
    titles: outcome.titles,
    topicNames: Object.fromEntries(
      snapshot.topics.map((topic) => [topic.id, topic.ja]),
    ),
    points: outcome.points,
    totals: outcome.totals,
    portionCompleted: outcome.portionCompleted,
    todayOpen: outcome.todayOpen,
    continueToday: outcome.continueToday,
  };
}
