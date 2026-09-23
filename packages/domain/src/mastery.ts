import { nextMilestone, previousMilestone } from "./milestones";
import { TUNING, type MilestoneSeries } from "./tuning";
import type { AnswerRecord, DayKey, SubtopicRef } from "./types";

export interface Mastery {
  readonly cardId: string;
  /** The round's day of the answer that made the card mastered. */
  readonly day: DayKey;
  readonly roundId: string;
}

/**
 * Every mastered card: correct on its first pass on two different days.
 * Retries never count; a placement round counts like any other.
 */
export function masteredCards(answers: readonly AnswerRecord[]): Map<string, Mastery> {
  const okDays = new Map<string, Set<DayKey>>();
  const mastered = new Map<string, Mastery>();
  const oks = answers
    .filter((answer) => answer.pass === "first" && answer.result === "ok")
    .sort((a, b) => a.answeredAt - b.answeredAt);
  for (const answer of oks) {
    if (mastered.has(answer.cardId)) {
      continue;
    }
    const days = okDays.get(answer.cardId) ?? new Set<DayKey>();
    days.add(answer.day);
    okDays.set(answer.cardId, days);
    if (days.size >= 2) {
      mastered.set(answer.cardId, {
        cardId: answer.cardId,
        day: answer.day,
        roundId: answer.roundId,
      });
    }
  }
  return mastered;
}

/**
 * Where each answered card belongs: its current card, else its tombstone, else
 * the copy on its latest answer, so a deleted card keeps counting.
 */
export function resolvePlacement(
  cards: ReadonlyMap<string, SubtopicRef>,
  tombstones: ReadonlyMap<string, SubtopicRef>,
  answers: readonly AnswerRecord[],
): Map<string, SubtopicRef> {
  const where = new Map<string, SubtopicRef>();
  for (const answer of [...answers].sort((a, b) => a.answeredAt - b.answeredAt)) {
    where.set(answer.cardId, { topic: answer.topic, subtopic: answer.subtopic });
  }
  for (const [cardId, fallback] of where) {
    const ref = cards.get(cardId) ?? tombstones.get(cardId) ?? fallback;
    where.set(cardId, { topic: ref.topic, subtopic: ref.subtopic });
  }
  return where;
}

function tally(keys: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function reachByTopic(
  cardIds: Iterable<string>,
  where: ReadonlyMap<string, SubtopicRef>,
): Map<string, number> {
  return tally([...cardIds].flatMap((id) => where.get(id)?.topic ?? []));
}

/** Keyed `topic/subtopic`. */
export function reachBySubtopic(
  cardIds: Iterable<string>,
  where: ReadonlyMap<string, SubtopicRef>,
): Map<string, number> {
  return tally(
    [...cardIds].flatMap((id) => {
      const ref = where.get(id);
      return ref === undefined ? [] : [`${ref.topic}/${ref.subtopic}`];
    }),
  );
}

export interface RingProgress {
  readonly from: number;
  readonly to: number;
  readonly done: number;
  readonly span: number;
}

/** A ring fills from the last milestone to the next and starts over past it. */
export function ringProgress(
  count: number,
  series: MilestoneSeries = TUNING.reachMilestones,
): RingProgress {
  const from = previousMilestone(count, series);
  const to = nextMilestone(count, series);
  return { from, to, done: count - from, span: to - from };
}

/** The chosen topic with the fewest cards left to its next milestone. */
export function nearestMilestone(
  reach: ReadonlyMap<string, number>,
  topics: readonly string[],
  series: MilestoneSeries = TUNING.reachMilestones,
): { topic: string; remaining: number } | undefined {
  let best: { topic: string; remaining: number } | undefined;
  for (const topic of topics) {
    const count = reach.get(topic) ?? 0;
    const remaining = nextMilestone(count, series) - count;
    if (best === undefined || remaining < best.remaining) {
      best = { topic, remaining };
    }
  }
  return best;
}
