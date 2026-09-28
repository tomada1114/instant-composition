import { nextMilestone, previousMilestone } from "./milestones";
import { TUNING, type MilestoneSeries } from "./tuning";
import type { AnswerRecord, SubtopicRef } from "./types";

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
