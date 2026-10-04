import { VOCAB_TUNING, type QueuedCard } from "@instant-composition/domain";

import type { VocabCategory } from "./vocab-item";
import type { CatalogSnapshot } from "./catalog";
import type { VocabCandidate, VocabReadModel } from "./read-model";
import type { LearnerStore } from "./store";
import { vocabLevelOrder } from "./vocab-projection";
import type { VocabHub } from "./vocab-views";

/** At most the fixed new quota plus one extra session per category. */
export async function freshVocabCandidates(
  store: LearnerStore,
  model: VocabReadModel,
  _snapshot: CatalogSnapshot,
  level: number,
): Promise<VocabCandidate[]> {
  const bound = Math.max(...VOCAB_TUNING.newPerDay) + VOCAB_TUNING.extraSize;
  const base = {
    day: model.day,
    generation: model.generation,
    limit: bound,
    cursor: null,
  } as const;
  const weakPages = await Promise.all(
    [null, ...VOCAB_TUNING.categories].map((category) =>
      store.vocabCandidates({ ...base, mode: "freshWeak", category, level: null }),
    ),
  );
  const weak = [
    ...new Map(
      weakPages.flatMap((page) =>
        page.rows.map(({ value }) => [value.cardId, value] as const),
      ),
    ).values(),
  ].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  const plainPages = await Promise.all(
    VOCAB_TUNING.categories.flatMap((category) =>
      ["fresh", "freshLower"].map((mode) =>
        store.vocabCandidates({
          ...base,
          mode: mode === "fresh" ? "fresh" : "freshLower",
          category,
          level: null,
          after: {
            order: `${vocabLevelOrder(level - 1, mode === "freshLower")}${mode === "freshLower" ? "#\uffff" : ""}`,
            cardId: "",
          },
        }),
      ),
    ),
  );
  const plain = plainPages.flatMap((page) => page.rows.map(({ value }) => value));
  const levels = [...new Set(plain.map((card) => card.cardLevel))];
  const ordered = [
    ...levels.filter((step) => step >= level - 1).sort((a, b) => a - b),
    ...levels.filter((step) => step < level - 1).sort((a, b) => b - a),
  ];
  const groups = ordered.map((step) => {
    const categories = VOCAB_TUNING.categories.map((category) =>
      plain.filter((card) => card.cardCategory === category && card.cardLevel === step),
    );
    const length = Math.max(0, ...categories.map((cards) => cards.length));
    return Array.from({ length }, (_, index) =>
      categories.flatMap((cards) => cards[index] ?? []),
    ).flat();
  });
  return [...weak, ...groups.flat()];
}

export interface ProjectedVocabPlan {
  readonly hub: VocabHub;
  readonly fresh: readonly QueuedCard[];
  readonly reviews: readonly QueuedCard[];
  readonly dueByCategory: ReadonlyMap<VocabCategory, number>;
  readonly newCount: number;
}

/** Counts and bounded quota candidates; no learner-wide progress or card read. */
export async function projectedVocabPlan(
  store: LearnerStore,
  model: VocabReadModel,
  snapshot: CatalogSnapshot,
  limits: {
    readonly vocabNewPerDay: number;
    readonly vocabReviewsPerDay: number | null;
  },
  level: number,
): Promise<ProjectedVocabPlan> {
  const sum = (
    field: "due" | "fresh" | "weak" | "tomorrow" | "introduced" | "reviewed" | "total",
  ) => model.counts.reduce((total, count) => total + count[field], 0);
  const quota =
    limits.vocabReviewsPerDay === null
      ? Infinity
      : Math.max(0, limits.vocabReviewsPerDay - sum("reviewed"));
  const due = Math.min(sum("due"), quota);
  const newCount = Math.max(
    0,
    Math.min(sum("fresh"), limits.vocabNewPerDay - sum("introduced"), quota - due),
  );
  const [duePage, fresh] = await Promise.all([
    store.vocabCandidates({
      day: model.day,
      generation: model.generation,
      mode: "due",
      category: null,
      level: null,
      limit: Math.max(1, Math.min(200, due)),
      cursor: null,
    }),
    freshVocabCandidates(store, model, snapshot, level),
  ]);
  const dueByCategory = new Map(
    model.counts.map((count) => [count.category, quota === Infinity ? count.due : 0]),
  );
  if (quota !== Infinity) {
    for (const row of duePage.rows.slice(0, due)) {
      const category = row.value.cardCategory;
      dueByCategory.set(category, (dueByCategory.get(category) ?? 0) + 1);
    }
  }
  const selected = fresh.slice(0, newCount);
  const categories = model.counts.map((count) => {
    const reviews = dueByCategory.get(count.category) ?? 0;
    const newCards = selected.filter(
      ({ cardCategory }) => cardCategory === count.category,
    ).length;
    return {
      category: count.category,
      due: reviews,
      new: newCards,
      learning: count.learning,
      total: count.total,
      extra: Math.min(
        VOCAB_TUNING.extraSize,
        count.due - reviews + count.fresh - newCards,
      ),
      weak: Math.min(VOCAB_TUNING.weak.sessionSize, count.weak),
    };
  });
  return {
    hub: {
      empty: sum("total") === 0,
      today: {
        due,
        new: newCount,
        minutes: Math.ceil(((due + newCount) * VOCAB_TUNING.secondsPerCard) / 60),
      },
      categories,
      extra: Math.min(
        VOCAB_TUNING.extraSize,
        sum("due") - due + sum("fresh") - newCount,
      ),
      weak: Math.min(VOCAB_TUNING.weak.sessionSize, sum("weak")),
      tomorrow:
        limits.vocabReviewsPerDay === null
          ? sum("tomorrow")
          : Math.min(sum("tomorrow"), limits.vocabReviewsPerDay),
    },
    fresh: fresh.map(({ cardId, kind }) => ({ cardId, kind })),
    reviews: duePage.rows.map(({ value }) => ({
      cardId: value.cardId,
      kind: value.kind,
    })),
    dueByCategory,
    newCount,
  };
}
