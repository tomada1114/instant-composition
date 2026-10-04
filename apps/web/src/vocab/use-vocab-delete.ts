import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type Dispatch } from "react";
import type { PagedOutbox } from "./paged-outbox";
import type { StudyEvent, StudyState } from "../study/study-state";
import { deleteVocabCard } from "../lib/vocab-endpoints";

/** Owns confirmation and deletion; waits for answer sends before removing progress. */
export function useVocabDelete(
  state: StudyState,
  dispatch: Dispatch<StudyEvent>,
  queue: PagedOutbox,
  onClose: () => void,
): {
  readonly asking: boolean;
  readonly pending: boolean;
  readonly failures: number;
  readonly ask: () => void;
  readonly keep: () => void;
  readonly confirm: () => void;
} {
  const cache = useQueryClient();
  const [cardId, setCardId] = useState<string>();
  const [pending, setPending] = useState(false);
  const [failures, setFailures] = useState(0);
  const live = useRef(false);
  const sending = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  return {
    asking: cardId !== undefined,
    pending,
    failures,
    ask() {
      if (state.phase.kind === "back" && !state.paused) setCardId(state.card?.cardId);
    },
    keep() {
      if (sending.current) return;
      setCardId(undefined);
      onClose();
    },
    confirm() {
      if (cardId === undefined || sending.current) return;
      sending.current = true;
      setPending(true);
      // A previously graded re-ask may still be sending. Its write must finish before DELETE.
      void queue
        .flush()
        .then((empty) => (empty ? deleteVocabCard(cardId) : undefined))
        .then(async (result) => {
          if (result?.ok === true) {
            await queue.removeCard(cardId);
            void cache.invalidateQueries({ queryKey: ["vocab"] });
          }
          if (!live.current) return;
          if (result?.ok !== true) {
            setFailures((count) => count + 1);
            return;
          }
          setCardId(undefined);
          onClose();
          dispatch({ type: "remove", cardId });
        })
        .catch(() => {
          if (live.current) setFailures((count) => count + 1);
        })
        .finally(() => {
          sending.current = false;
          if (live.current) setPending(false);
        });
    },
  };
}
