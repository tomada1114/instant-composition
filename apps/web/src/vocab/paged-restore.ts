import type { VocabPage } from "../openapi";
import type { AnswerInput } from "../study/study-state";
import { FRESH_FRONT } from "../study/study-state";
import { nextCard } from "../study/re-asks";
import { initPagedVocab, pagedVocabReducer, type VocabPagedState } from "./paged-state";
import { readVocabCheckpoint } from "./paged-checkpoint";

/** Reload keeps ordering and identities while withdrawing cards the current catalog no longer shows. */
export function restorePagedVocab(
  page: VocabPage,
  pending: readonly AnswerInput[],
): VocabPagedState {
  const saved = readVocabCheckpoint(page.sessionId, page.generation);
  if (saved === undefined) return initPagedVocab(page, pending);
  const cards = Object.fromEntries([
    ...page.cards.map(
      (card) => [card.id, { card, page: page.page, slot: card.slot }] as const,
    ),
    ...page.retained.map(
      (card) => [card.id, { card, page: card.page, slot: card.slot }] as const,
    ),
  ]);
  const answered = new Set(page.answered);
  let kept: VocabPagedState = {
    ...saved,
    cards,
    fresh: saved.fresh.filter((id) => cards[id] !== undefined && !answered.has(id)),
    reAsks: saved.reAsks.filter((card) => cards[card.cardId] !== undefined),
  };
  if (saved.phase.kind === "back" && saved.card !== undefined) {
    const origin = cards[saved.card.cardId];
    const id =
      origin === undefined
        ? undefined
        : `p:${String(origin.page)}:${String(saved.card.ask)}:${String(origin.slot)}`;
    const durable = pending.find((answer) => answer.id === id);
    if (durable !== undefined)
      kept = pagedVocabReducer(kept, {
        type: "grade",
        at: saved.phase.since + 151,
        wall: durable.answeredAt ?? 0,
        grade: durable.grade,
        key: false,
      });
  }
  if (
    saved.card === undefined ||
    cards[saved.card.cardId] !== undefined ||
    saved.phase.kind === "finishing"
  )
    return kept;
  const next = nextCard(kept);
  return next === undefined
    ? { ...kept, phase: { kind: "finishing" } }
    : { ...kept, ...next, phase: FRESH_FRONT };
}
