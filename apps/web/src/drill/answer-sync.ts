import { useEffect, useState, type Dispatch } from "react";

import type { RoundPayload } from "../openapi";
import {
  createAnswerQueue,
  flushEarlierRounds,
  queueKey,
  sessionStore,
  unsavedAnswers,
  type AnswerQueue,
} from "../study/answer-queue";
import { useQueuedStudy } from "../study/answer-sync";
import { drillReducer } from "./drill-machine";
import type { AnswerInput, DrillEvent, DrillState } from "./drill-state";
import { sendAnswer } from "./rounds";

export interface ArrivedQueue {
  readonly queue: AnswerQueue;
  /** What the queue held on arrival that `round` lacks; read once, so it never includes this page's answers. */
  readonly unsaved: readonly AnswerInput[];
}

/**
 * The round's answer queue, holding whatever an earlier page of this tab left
 * unsent; what earlier rounds left is sent on the side, apart from this queue.
 */
export function useAnswerQueue(
  round: Pick<RoundPayload, "id" | "deck" | "answered">,
): ArrivedQueue {
  const [arrived] = useState(() => {
    const queue = createAnswerQueue({
      key: queueKey(round.id),
      send: sendAnswer,
      storage: sessionStore(),
    });
    return { queue, unsaved: unsavedAnswers(queue.pending(), round) };
  });
  useEffect(() => {
    void flushEarlierRounds({
      currentId: round.id,
      send: sendAnswer,
      storage: sessionStore(),
    });
  }, [round.id]);
  return arrived;
}

/** The drill binds shared queue synchronization to its timed reducer. */
export function useQueuedDrill(
  queue: AnswerQueue,
  start: () => DrillState,
  onFailure: () => void,
): readonly [DrillState, Dispatch<DrillEvent>] {
  return useQueuedStudy(queue, start, onFailure, drillReducer);
}
