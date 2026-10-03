import { initStudy } from "../study/study-init";
import type { StudyState } from "../study/study-state";
import type { VocabSession } from "../openapi";

/** Vocabulary binds its own deck to the shared machine, with no timing configuration. */
export function initVocab(session: VocabSession): StudyState {
  return initStudy({
    sessionId: session.sessionId,
    deck: session.cards.map((card) => card.id),
    isNew: Object.fromEntries(session.cards.map((card) => [card.id, card.isNew])),
    answered: [],
    retries: true,
    intro: false,
  });
}
