import { initDrill } from "../drill/drill-init";
import type { DrillState } from "../drill/drill-state";
import type { VocabSession } from "../openapi";

/** A fresh vocabulary session reuses the drill's re-ask machine, without a timer. */
export function initVocab(session: VocabSession): DrillState {
  const cards = session.cards;
  return {
    ...initDrill({
      roundId: session.sessionId,
      deck: cards.map((card) => card.id),
      limits: Object.fromEntries(cards.map((card) => [card.id, 0])),
      fastThresholds: {},
      isNew: Object.fromEntries(cards.map((card) => [card.id, card.isNew])),
      answered: [],
      retries: true,
      intro: false,
    }),
    untimed: true,
  };
}
