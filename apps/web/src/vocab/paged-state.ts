import { learnerStorageRevision } from "../lib/learner-storage";
import type { VocabCard, VocabPage } from "../openapi";
import { initStudy } from "../study/study-init";
import { studyReducer } from "../study/study-machine";
import { nextCard } from "../study/re-asks";
import {
  FRESH_FRONT,
  type AnswerInput,
  type StudyEvent,
  type StudyState,
} from "../study/study-state";

export interface VocabPagedState extends StudyState {
  readonly generation: number;
  readonly storageRevision: string;
  readonly loadedPage: number;
  readonly continuation: string | null;
  readonly cards: Readonly<
    Record<
      string,
      { readonly card: VocabCard; readonly page: number; readonly slot: number }
    >
  >;
}

export type VocabPagedEvent =
  StudyEvent | { readonly type: "page"; readonly page: VocabPage };

/** Keep only this page, the current card and active re-asks, never a whole logical deck. */
function compact(state: VocabPagedState): VocabPagedState {
  const active = new Set([
    ...state.fresh,
    ...state.reAsks.map((card) => card.cardId),
    ...(state.card === undefined ? [] : [state.card.cardId]),
  ]);
  const keep = <T>(values: Readonly<Record<string, T>>): Readonly<Record<string, T>> =>
    Object.fromEntries(Object.entries(values).filter(([id]) => active.has(id)));
  return {
    ...state,
    asked: keep(state.asked),
    goods: keep(state.goods),
    isNew: keep(state.isNew),
    cards: keep(state.cards),
    answers: state.answers.slice(-1),
  };
}

/** An initial page skips server-adopted and still queued first passes under their original ids. */
export function initPagedVocab(
  page: VocabPage,
  pending: readonly AnswerInput[],
): VocabPagedState {
  const base = initStudy({
    sessionId: page.sessionId,
    deck: page.cards.map((card) => card.id),
    isNew: Object.fromEntries(page.cards.map((card) => [card.id, card.isNew])),
    answered: [
      ...page.answered.map((cardId) => ({ cardId, pass: "first" as const })),
      ...pending,
    ],
    retries: true,
    intro: false,
  });
  return compact({
    ...base,
    generation: page.generation,
    storageRevision: learnerStorageRevision(),
    loadedPage: page.page,
    total: page.total,
    hasMore: page.continuation !== null,
    continuation: page.continuation,
    cards: Object.fromEntries(
      page.cards.map((card) => [card.id, { card, page: page.page, slot: card.slot }]),
    ),
  });
}

/** Page EOF waits for continuation before accelerating re-asks or declaring logical completion. */
export function pagedVocabReducer(
  state: VocabPagedState,
  event: VocabPagedEvent,
): VocabPagedState {
  if (event.type === "page") {
    if (
      event.page.generation !== state.generation ||
      event.page.sessionId !== state.sessionId ||
      event.page.page !== state.loadedPage + 1 ||
      state.phase.kind !== "finishing"
    )
      return state;
    const page = event.page;
    const answered = new Set(page.answered);
    const base = {
      ...state,
      loadedPage: page.page,
      firstShown: state.firstShown + page.answered.length,
      fresh: page.cards.filter((card) => !answered.has(card.id)).map((card) => card.id),
      isNew: {
        ...state.isNew,
        ...Object.fromEntries(page.cards.map((card) => [card.id, card.isNew])),
      },
      cards: {
        ...state.cards,
        ...Object.fromEntries(
          page.cards.map((card) => [
            card.id,
            { card, page: page.page, slot: card.slot },
          ]),
        ),
      },
      hasMore: page.continuation !== null,
      continuation: page.continuation,
    };
    const next = nextCard(base);
    return compact(
      next === undefined ? base : { ...base, ...next, phase: FRESH_FRONT },
    );
  }
  const next = studyReducer(state, event);
  if (next === state) return state;
  const latest = next.answers.at(-1);
  const origin = latest === undefined ? undefined : state.cards[latest.cardId];
  const added = event.type === "grade" && next.answers.length > state.answers.length;
  const answers =
    latest === undefined
      ? []
      : [
          {
            ...latest,
            ...(origin === undefined || !added
              ? {}
              : {
                  id: `p:${String(origin.page)}:${String(state.card?.ask ?? 0)}:${String(origin.slot)}`,
                  vocabPage: origin.page,
                  vocabGeneration: state.generation,
                }),
          },
        ];
  return compact({ ...state, ...next, answers });
}
