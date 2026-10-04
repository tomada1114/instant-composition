import {
  VOCAB_TUNING,
  type QueuedCard,
  type VocabSession,
} from "@instant-composition/domain";

import type { VocabCategory } from "./vocab-item";
import type { CatalogSnapshot } from "./catalog";
import type { VocabCandidate, VocabReadModel } from "./read-model";
import type { LearnerStore } from "./store";
import { freshVocabCandidates, projectedVocabPlan } from "./vocab-read-plan";

/** Candidate ports and counts stay separate; an explicitly unlimited legacy session may traverse pages. */
export async function dealProjectedVocab(
  store: LearnerStore,
  model: VocabReadModel,
  snapshot: CatalogSnapshot,
  limits: {
    readonly vocabNewPerDay: number;
    readonly vocabReviewsPerDay: number | null;
  },
  level: number,
  kind: VocabSession["kind"],
  category: VocabCategory | null,
): Promise<QueuedCard[]> {
  const base = {
    day: model.day,
    generation: model.generation,
    level: null,
    cursor: null,
  } as const;
  if (kind === "weak") {
    const page = await store.vocabCandidates({
      ...base,
      mode: "weak",
      category,
      limit: VOCAB_TUNING.weak.sessionSize,
    });
    return page.rows.map(({ value }) => ({ cardId: value.cardId, kind: value.kind }));
  }
  const plan = await projectedVocabPlan(store, model, snapshot, limits, level);
  const fresh = await freshVocabCandidates(store, model, snapshot, level);
  const firstFresh = fresh.slice(0, plan.newCount);
  const sum = (field: "due" | "reviewed"): number =>
    model.counts.reduce((total, count) => total + count[field], 0);
  const reviews =
    limits.vocabReviewsPerDay === null
      ? sum("due")
      : Math.min(sum("due"), Math.max(0, limits.vocabReviewsPerDay - sum("reviewed")));
  const allocated = plan.reviews;
  if (kind === "extra") {
    const last = allocated.at(-1);
    const lastRow =
      last === undefined || limits.vocabReviewsPerDay === null
        ? undefined
        : (
            await store.vocabCandidates({
              ...base,
              mode: "due",
              category: null,
              limit: Math.max(1, reviews),
            })
          ).rows.at(-1)?.value;
    const due =
      limits.vocabReviewsPerDay === null || sum("due") === reviews
        ? []
        : (
            await store.vocabCandidates({
              ...base,
              mode: "due",
              category,
              limit: VOCAB_TUNING.extraSize,
              ...(lastRow === undefined
                ? {}
                : { after: { order: lastRow.order, cardId: lastRow.cardId } }),
            })
          ).rows.map(({ value }) => value);
    const held = new Set(firstFresh.map(({ cardId }) => cardId));
    return [
      ...due,
      ...fresh.filter(
        (card) =>
          !held.has(card.cardId) &&
          (category === null || card.cardCategory === category),
      ),
    ]
      .slice(0, VOCAB_TUNING.extraSize)
      .map(({ cardId, kind }) => ({ cardId, kind }));
  }
  const dueRows: VocabCandidate[] = [];
  let cursor: string | null = null;
  do {
    const page = await store.vocabCandidates({
      ...base,
      mode: "due",
      category: null,
      limit: Math.max(1, Math.min(250, reviews - dueRows.length)),
      cursor,
    });
    dueRows.push(...page.rows.map(({ value }) => value));
    cursor = page.cursor;
  } while (cursor !== null && dueRows.length < reviews);
  const queue: VocabCandidate[] = [];
  let placed = 0;
  firstFresh.forEach((card, index) => {
    const before = Math.floor(((index + 1) * reviews) / firstFresh.length);
    queue.push(...dueRows.slice(placed, before), card);
    placed = before;
  });
  queue.push(...dueRows.slice(placed));
  return queue
    .filter((card) => category === null || card.cardCategory === category)
    .map(({ cardId, kind }) => ({ cardId, kind }));
}
