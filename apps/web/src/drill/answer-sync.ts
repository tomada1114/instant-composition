import { useEffect, useRef, useState } from "react";

import type { RoundPayload } from "../openapi";
import {
  createAnswerQueue,
  sessionStore,
  unsavedAnswers,
  type AnswerQueue,
} from "./answer-queue";
import type { AnswerInput } from "./drill-state";
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
 * Sends every answer the reducer adds through `queue`, once each, along with
 * what it held on arrival, and calls `onFailure` when one fails to save.
 */
export function useAnswerSync(
  queue: AnswerQueue,
  answers: readonly AnswerInput[],
  onFailure: () => void,
): void {
  const sent = useRef(0);
  const report = useRef(onFailure);
  useEffect(() => {
    report.current = onFailure;
  });

  useEffect(() => {
    const fresh = answers.slice(sent.current);
    sent.current = answers.length;
    const delivery =
      fresh.length > 0 ? fresh.map((answer) => queue.enqueue(answer)) : [queue.flush()];
    for (const delivered of delivery) {
      void delivered.then((done) => {
        if (!done) report.current();
      });
    }
  }, [answers, queue]);
}
