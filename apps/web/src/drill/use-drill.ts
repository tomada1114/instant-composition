import { useEffect, useRef, useState, type Dispatch } from "react";

import { TUNING } from "../lib/tuning";
import type { Grade, GradeKeyTrio, RoundSummary } from "../openapi";
import { currentCard, type DrillEvent, type DrillState } from "./drill-state";
import { requestFinish } from "./rounds";
import { keyAction, type DrillKeyAction } from "./keys";
import type { AnswerQueue } from "./answer-queue";
import { queuedFinish } from "./queued-finish";

/** How often the front's clock is read; also the timer bar's step. */
const TICK_MS = 100;

/** What the page asks of the drill: a key's action, or the page going hidden. */
export type DrillAction = DrillKeyAction | { readonly type: "hide" };

/** How long a grade's feedback holds before the next front; never over 320 ms. */
export function feedbackMs(feedback: {
  readonly grade: Grade;
  readonly fast: boolean;
}): number {
  if (feedback.grade === "again") return 160;
  return feedback.fast ? TUNING.feedbackMaxMs : 240;
}

/**
 * Feeds the reducer its clock: `shown` on the frame the front is drawn, a
 * tick while it runs, and `advance` once a grade's feedback is over.
 */
export function useDrillClock(
  state: DrillState,
  dispatch: Dispatch<DrillEvent>,
  timed = true,
): void {
  const { phase, paused } = state;
  const card = currentCard(state);
  const cardKey = card === undefined ? "" : `${String(card.ask)}:${card.cardId}`;
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
    if (!running || !timed) return undefined;
    const timer = setInterval(() => {
      dispatch({ type: "tick", at: performance.now() });
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [running, dispatch, timed]);

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

/** A key typed into a field is text, not the drill's; only Escape still pauses from one. */
function inField(event: KeyboardEvent): boolean {
  return (
    event.key !== "Escape" &&
    event.target instanceof Element &&
    event.target.closest("input, textarea") !== null
  );
}

/**
 * Routes the drill's keys to `onAction`, grading with `gradeKeys`, and pauses
 * when the page is hidden. A page shown again stays paused: the dialog waits
 * for "continue".
 */
export function useDrillKeys(
  state: DrillState,
  gradeKeys: GradeKeyTrio,
  onAction: (action: DrillAction) => void,
): void {
  const latest = useRef({ state, gradeKeys, onAction });
  useEffect(() => {
    latest.current = { state, gradeKeys, onAction };
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.repeat || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey || inField(event)) return;
      const action = keyAction(latest.current.state, event, latest.current.gradeKeys);
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

export type FinishState =
  | { readonly status: "idle" | "sending" | "failed"; readonly retry: () => void }
  | {
      readonly status: "done";
      readonly summary: RoundSummary;
      readonly retry: () => void;
    };

/**
 * Asks for the round's summary once the drill is finishing, sending what the
 * server may not hold yet — read from the settled queue at each attempt — ahead of it
 * and with it, so the summary is whole even when some single sends failed.
 */
export function useRoundFinish(options: {
  readonly roundId: string;
  readonly finishing: boolean;
  readonly queue: AnswerQueue;
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
    void queuedFinish(latest.current.queue, (pending, notBefore) =>
      requestFinish(roundId, pending, notBefore),
    ).then((finished) => {
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
