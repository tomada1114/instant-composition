import type { QueuedCard } from "./queue";
import { VOCAB_TUNING } from "./tuning";
import {
  isNewCard,
  type VocabCategory,
  type VocabSessionKind,
  type VocabState,
} from "./vocab";
import { dueTomorrow, vocabQueue, weakCards } from "./vocab-queue";

/** Derived once from one learner/day/settings state, owned by its caller. */
export interface VocabPlan {
  readonly figures: {
    readonly due: number;
    readonly fresh: number;
    readonly minutes: number;
    readonly categories: readonly {
      readonly category: VocabCategory;
      readonly due: number;
      readonly fresh: number;
      readonly learning: number;
      readonly total: number;
    }[];
    readonly weak: number;
    readonly tomorrow: number;
  };
  /** A fresh array in the original order; category filtering precedes session caps. */
  readonly deal: (
    kind: VocabSessionKind,
    category: VocabCategory | null,
  ) => QueuedCard[];
}

function count(cards: readonly QueuedCard[], kind: QueuedCard["kind"]): number {
  return cards.filter((card) => card.kind === kind).length;
}

/** Today's queue, extras, weak cards and category index shared within one request. */
export function planVocab(state: VocabState): VocabPlan {
  const { queue, extra } = vocabQueue(state);
  const weak = weakCards(state);
  const categories = new Map(state.cards.map((card) => [card.id, card.category]));
  const share = (
    cards: readonly QueuedCard[],
    category: VocabCategory | null,
  ): QueuedCard[] =>
    cards.filter(
      (card) => category === null || categories.get(card.cardId) === category,
    );
  return {
    figures: {
      due: count(queue, "review"),
      fresh: count(queue, "new"),
      minutes: Math.ceil((queue.length * VOCAB_TUNING.secondsPerCard) / 60),
      categories: VOCAB_TUNING.categories.map((category) => {
        const queued = share(queue, category);
        const cards = state.cards.filter((card) => card.category === category);
        return {
          category,
          due: count(queued, "review"),
          fresh: count(queued, "new"),
          learning: cards.filter((card) => !isNewCard(state.progress.get(card.id)))
            .length,
          total: cards.length,
        };
      }),
      weak: weak.length,
      tomorrow: dueTomorrow(state),
    },
    deal: (kind, category) => {
      if (kind === "today") return share(queue, category);
      return kind === "weak"
        ? share(weak, category).slice(0, VOCAB_TUNING.weak.sessionSize)
        : share(extra, category).slice(0, VOCAB_TUNING.extraSize);
    },
  };
}
