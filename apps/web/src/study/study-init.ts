import { FRESH_FRONT, type StudyState } from "./study-state";
import type { Pass } from "../openapi";
import { nextCard } from "./re-asks";

export interface StudyInit {
  readonly sessionId: string;
  readonly deck: readonly string[];
  readonly isNew: Readonly<Record<string, boolean>>;
  readonly answered: readonly { readonly cardId: string; readonly pass: Pass }[];
  readonly retries: boolean;
  readonly intro: boolean;
}

/**
 * The state a study session opens on, past what the server and this tab's queue
 * already hold. Only first passes count: a re-ask that was waiting when the
 * page went away is dropped, as the first answer already set the schedule.
 */
export function initStudy(init: StudyInit): StudyState {
  const answeredFirst = new Set(
    init.answered.filter((a) => a.pass === "first").map((a) => a.cardId),
  );
  const base: StudyState = {
    sessionId: init.sessionId,
    retries: init.retries,
    isNew: init.isNew,
    fresh: init.deck.filter((id) => !answeredFirst.has(id)),
    firstShown: answeredFirst.size,
    card: undefined,
    reAsks: [],
    step: 0,
    asked: {},
    goods: {},
    paused: false,
    answers: [],
    phase: init.intro ? { kind: "intro" } : FRESH_FRONT,
  };
  return nextCard(base) ?? { ...base, phase: { kind: "finishing" } };
}
