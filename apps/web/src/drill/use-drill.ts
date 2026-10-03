import { useEffect, useRef, useState, type Dispatch } from "react";
import type { RoundSummary } from "../openapi";
import { useStudyClock } from "../study/use-study";
import type { DrillEvent, DrillState } from "./drill-state";
import { requestFinish } from "./rounds";
import type { AnswerQueue } from "../study/answer-queue";
import { queuedFinish } from "../study/queued-finish";

export {
  feedbackMs,
  useStudyKeys as useDrillKeys,
  type StudyAction as DrillAction,
} from "../study/use-study";

/** Adds only timed drill ticks to the shared front and feedback clock. */
export function useDrillClock(state: DrillState, dispatch: Dispatch<DrillEvent>): void {
  useStudyClock(state, dispatch);
  const running =
    state.phase.kind === "front" && state.phase.runningSince !== null && !state.paused;
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => {
      dispatch({ type: "tick", at: performance.now() });
    }, 100);
    return () => {
      clearInterval(timer);
    };
  }, [running, dispatch]);
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
