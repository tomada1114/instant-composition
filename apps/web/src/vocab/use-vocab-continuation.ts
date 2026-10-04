import { useEffect, useState, type Dispatch } from "react";
import { getPagedVocabPage } from "../lib/vocab-paged-endpoints";
import type { VocabPagedEvent, VocabPagedState } from "./paged-state";

/** A failed page request keeps its exact cursor and all active re-ask state for retry. */
export function useVocabContinuation(
  state: VocabPagedState,
  dispatch: Dispatch<VocabPagedEvent>,
): { readonly waiting: boolean; readonly failed: boolean; readonly retry: () => void } {
  const waiting = state.phase.kind === "finishing" && state.continuation !== null;
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!waiting) return undefined;
    let active = true;
    void getPagedVocabPage(state.sessionId, state.continuation).then((result) => {
      if (!active) return;
      if (result.ok) dispatch({ type: "page", page: result.value });
      else setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [waiting, state.sessionId, state.continuation, dispatch, attempt]);
  return {
    waiting,
    failed,
    retry() {
      setFailed(false);
      setAttempt((value) => value + 1);
    },
  };
}
