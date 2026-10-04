import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { VocabPage, VocabPagedSummary } from "../openapi";
import type { PagedOutbox } from "./paged-outbox";
import { err } from "../lib/result";
import { finishPagedVocabSession } from "../lib/vocab-paged-endpoints";
import { clearVocabCheckpoint } from "./paged-checkpoint";

/** A logical finish clears durable state only after its pending answers and close are acknowledged. */
export function useVocabFinish(
  session: VocabPage,
  queue: PagedOutbox,
  finishing: boolean,
): {
  readonly summary: VocabPagedSummary | undefined;
  readonly failed: boolean;
  readonly retry: () => void;
} {
  const cache = useQueryClient();
  const [summary, setSummary] = useState<VocabPagedSummary>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!finishing) return undefined;
    let active = true;
    const finish = async () => {
      if (!(await queue.flush()) || Date.now() < queue.retryAt())
        return err({ code: "ERR_NETWORK" as const });
      const result = await finishPagedVocabSession(
        session.sessionId,
        session.generation,
        [],
      );
      if (!result.ok && result.error.retryAt !== undefined)
        await queue.deferUntil(result.error.retryAt);
      return result;
    };
    void finish().then((result) => {
      if (!active) return;
      if (result.ok) {
        clearVocabCheckpoint(session.sessionId);
        setSummary(result.value);
        void cache.invalidateQueries({ queryKey: ["vocab"] });
      } else setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [finishing, session.sessionId, session.generation, queue, cache, attempt]);
  return {
    summary,
    failed,
    retry() {
      setFailed(false);
      setAttempt((value) => value + 1);
    },
  };
}
