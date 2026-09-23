import { useEffect, useRef, useState, type Dispatch } from "react";

import type { AnswerInput } from "../../core/api";
import { currentCard, type DrillEvent, type DrillState } from "../../core/drill-state";
import { TUNING } from "../../core/tuning";
import type { RoundSummary } from "../../core/views";
import { createAnswerQueue, type AnswerQueue, type QueueStorage } from "./answer-queue";
import { requestFinish, sendAnswer } from "./api";
import { keyAction, type DrillKeyAction } from "./keys";

/** How often the front's clock is read; also the timer bar's step. */
const TICK_MS = 100;

/** What the page asks of the drill: a key's action, or the page going hidden. */
export type DrillAction = DrillKeyAction | { readonly type: "hide" };

/** How long a grade's feedback holds before the next front; never over 320 ms. */
export function feedbackMs(feedback: {
  readonly result: "ok" | "ng";
  readonly fast: boolean;
}): number {
  if (feedback.result === "ng") return 160;
  return feedback.fast ? TUNING.feedbackMaxMs : 240;
}

/**
 * Feeds the reducer its clock: `shown` on the frame the front is drawn, a
 * tick while it runs, and `advance` once a grade's feedback is over.
 */
export function useDrillClock(state: DrillState, dispatch: Dispatch<DrillEvent>): void {
  const { phase, paused } = state;
  const card = currentCard(state);
  const cardKey = card === undefined ? "" : `${card.pass}:${card.cardId}`;
  const waiting = phase.kind === "front" && phase.runningSince === null && !paused;
  const running = phase.kind === "front" && phase.runningSince !== null && !paused;
  const hold = phase.kind === "feedback" ? feedbackMs(phase) : undefined;

  useEffect(() => {
    if (!waiting) return undefined;
    const frame = requestAnimationFrame(() => {
      dispatch({ type: "shown", at: performance.now() });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [waiting, cardKey, dispatch]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => {
      dispatch({ type: "tick", at: performance.now() });
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [running, dispatch]);

  useEffect(() => {
    if (hold === undefined) return undefined;
    const timer = setTimeout(() => {
      dispatch({ type: "advance", at: performance.now() });
    }, hold);
    return () => {
      clearTimeout(timer);
    };
  }, [hold, cardKey, dispatch]);
}

/**
 * Routes the drill's keys to `onAction`, and pauses when the page is hidden.
 * A page shown again stays paused: the sheet waits for "continue".
 */
export function useDrillKeys(
  state: DrillState,
  onAction: (action: DrillAction) => void,
): void {
  const latest = useRef({ state, onAction });
  useEffect(() => {
    latest.current = { state, onAction };
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.repeat || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const action = keyAction(latest.current.state, event.key);
      if (action === undefined) return;
      event.preventDefault();
      latest.current.onAction(action);
    }
    function onVisibility(): void {
      if (document.visibilityState === "hidden")
        latest.current.onAction({ type: "hide" });
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}

function sessionStore(): QueueStorage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Sends every answer the reducer adds, once each, and calls `onFailure` when one fails to save. */
export function useAnswerSync(
  roundId: string,
  answers: readonly AnswerInput[],
  onFailure: () => void,
): AnswerQueue {
  const [queue] = useState(() =>
    createAnswerQueue({
      key: `drill-answers:${roundId}`,
      send: sendAnswer,
      storage: sessionStore(),
    }),
  );
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

  return queue;
}

export type FinishState =
  | { readonly status: "idle" | "sending" | "failed"; readonly retry: () => void }
  | {
      readonly status: "done";
      readonly summary: RoundSummary;
      readonly retry: () => void;
    };

/**
 * Asks for the round's summary once the drill is finishing, sending every
 * answer of this session with it so the summary is whole even when some
 * single sends failed.
 */
export function useRoundFinish(options: {
  readonly roundId: string;
  readonly finishing: boolean;
  readonly answers: readonly AnswerInput[];
  readonly onDone: (summary: RoundSummary) => void;
}): FinishState {
  const { roundId, finishing } = options;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<
    { status: "failed" } | { status: "done"; summary: RoundSummary } | undefined
  >(undefined);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (!finishing) return undefined;
    let current = true;
    void requestFinish(roundId, latest.current.answers).then((finished) => {
      if (!current) return;
      if (finished.ok) {
        latest.current.onDone(finished.value);
        setResult({ status: "done", summary: finished.value });
      } else {
        setResult({ status: "failed" });
      }
    });
    return () => {
      current = false;
    };
  }, [finishing, roundId, attempt]);

  const retry = (): void => {
    setResult(undefined);
    setAttempt((count) => count + 1);
  };
  if (result !== undefined) return { ...result, retry };
  return { status: finishing ? "sending" : "idle", retry };
}
