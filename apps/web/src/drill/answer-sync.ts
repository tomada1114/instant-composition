import { useEffect, useRef, useState, type Dispatch } from "react";

import type { RoundPayload } from "../openapi";
import {
  createAnswerQueue,
  sessionStore,
  unsavedAnswers,
  type AnswerQueue,
} from "./answer-queue";
import { drillReducer } from "./drill-machine";
import type { AnswerInput, DrillEvent, DrillState } from "./drill-state";
import { sendAnswer } from "./rounds";

export interface ArrivedQueue {
  readonly queue: AnswerQueue;
  /** What the queue held on arrival that `round` lacks; read once, so it never includes this page's answers. */
  readonly unsaved: readonly AnswerInput[];
}

/** The round's answer queue, holding whatever an earlier page of this tab left unsent. */
export function useAnswerQueue(
  round: Pick<RoundPayload, "id" | "deck" | "answered">,
): ArrivedQueue {
  const [arrived] = useState(() => {
    const queue = createAnswerQueue({
      key: `drill-answers:${round.id}`,
      send: sendAnswer,
      storage: sessionStore(),
    });
    return { queue, unsaved: unsavedAnswers(queue.pending(), round) };
  });
  return arrived;
}

/**
 * The drill's state, moved by `drillReducer`, with each answer an event adds
 * put in `queue` by the same call that dispatched it: stored before React
 * renders or runs an effect, so a reload right after a grade still finds it.
 * What the queue held on arrival is sent on mount; `onFailure` hears of each
 * answer that fails to save.
 */
export function useQueuedDrill(
  queue: AnswerQueue,
  start: () => DrillState,
  onFailure: () => void,
): readonly [DrillState, Dispatch<DrillEvent>] {
  const [state, setState] = useState(start);
  // Every event passes through `dispatch`, so this is always the state React will hold next.
  const latest = useRef(state);
  const report = useRef(onFailure);
  useEffect(() => {
    report.current = onFailure;
  });

  const [dispatch] = useState(() => {
    const deliver = (delivered: Promise<boolean>): void => {
      void delivered.then((done) => {
        if (!done) report.current();
      });
    };
    return {
      deliver,
      event: (event: DrillEvent): void => {
        const before = latest.current;
        const next = drillReducer(before, event);
        if (next === before) return;
        latest.current = next;
        for (const answer of next.answers.slice(before.answers.length)) {
          deliver(queue.enqueue(answer));
        }
        setState(next);
      },
    };
  });

  useEffect(() => {
    dispatch.deliver(queue.flush());
  }, [dispatch, queue]);

  return [state, dispatch.event];
}
