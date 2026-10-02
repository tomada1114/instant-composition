import { addDays, dayDiff } from "./day";
import { todaysQueue, type QueuedCard, type TodaysQueue } from "./queue";
import {
  answeredOn,
  isNewCard,
  isWeak,
  newCardOrder,
  recallOf,
  type VocabCard,
  type VocabCategory,
  type VocabState,
} from "./vocab";

/**
 * Today's vocabulary queue over every category. The review limit is a daily
 * one: reviews already answered today use it up, as new cards answered today
 * use up the new limit.
 */
export function vocabQueue(state: VocabState): TodaysQueue {
  const { today, progress } = state;
  const answeredToday = new Set(
    state.cards
      .filter((card) => answeredOn(progress.get(card.id), today))
      .map((card) => card.id),
  );
  const newAnsweredToday = state.cards.filter(
    (card) => answeredToday.has(card.id) && progress.get(card.id)?.firstDay === today,
  ).length;
  const reviewsAnswered = answeredToday.size - newAnsweredToday;
  const isNew = (card: VocabCard): boolean => isNewCard(progress.get(card.id));
  const fresh = newCardOrder(state.cards.filter(isNew), state.level, (id) =>
    isWeak(progress.get(id)),
  );
  return todaysQueue({
    today,
    candidates: [
      ...state.cards
        .filter((card) => !isNew(card))
        .map((card) => ({
          cardId: card.id,
          state: progress.get(card.id)?.state ?? undefined,
          isNew: false,
        })),
      ...fresh.map((card) => ({ cardId: card.id, state: undefined, isNew: true })),
    ],
    newLimit: state.newPerDay,
    reviewLimit:
      state.reviewsPerDay === null
        ? "unlimited"
        : Math.max(0, state.reviewsPerDay - reviewsAnswered),
    answeredToday,
    newAnsweredToday,
  });
}

/** The weak cards not answered today, the least likely recalled first. */
export function weakCards(state: VocabState): QueuedCard[] {
  return (
    state.cards
      .filter((card) => {
        const progress = state.progress.get(card.id);
        return isWeak(progress) && !answeredOn(progress, state.today);
      })
      .map((card) => ({
        card,
        recall: recallOf(state.progress.get(card.id), state.today),
      }))
      // Not a subtraction: two new cards' -Infinity would compare as NaN.
      .sort((a, b) => (a.recall === b.recall ? 0 : a.recall < b.recall ? -1 : 1))
      .map(({ card }): QueuedCard => {
        const isNew = isNewCard(state.progress.get(card.id));
        return { cardId: card.id, kind: isNew ? "new" : "review" };
      })
  );
}

/** Whether a queued card is in `category`; every card is when it is null. */
export function inCategory(
  state: VocabState,
  category: VocabCategory | null,
): (queued: QueuedCard) => boolean {
  const categories = new Map(state.cards.map((card) => [card.id, card.category]));
  return (queued) => category === null || categories.get(queued.cardId) === category;
}

/** Reviews due by tomorrow, as many as tomorrow's review limit lets through. */
export function dueTomorrow(state: VocabState): number {
  const tomorrow = addDays(state.today, 1);
  const due = state.cards.filter((card) => {
    const scheduled = state.progress.get(card.id)?.state ?? null;
    return scheduled !== null && dayDiff(scheduled.dueDay, tomorrow) >= 0;
  }).length;
  return state.reviewsPerDay === null ? due : Math.min(due, state.reviewsPerDay);
}
