import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { addTalkCards, makeCandidates } from "../lib/talk-card-endpoints";
import type { CardCandidate } from "../openapi";

export interface TalkCards {
  readonly status: "idle" | "waiting" | "failed" | "ready";
  readonly candidates: readonly CardCandidate[];
  readonly selected: readonly number[];
  readonly adding: boolean;
  readonly addFailed: boolean;
  readonly retry: () => void;
  readonly toggle: (index: number) => void;
  readonly add: () => void;
}

/** Mounted per talk: one automatic request, explicit retries and no late responses after leaving. */
export function useTalkCards(talkId: string, eligible: boolean): TalkCards {
  const cache = useQueryClient();
  const [status, setStatus] = useState<TalkCards["status"]>("idle");
  const [candidates, setCandidates] = useState<readonly CardCandidate[]>([]);
  const [selected, setSelected] = useState<readonly number[]>([]);
  const [adding, setAdding] = useState(false);
  const [addFailed, setAddFailed] = useState(false);
  const live = useRef(false);
  const asked = useRef(false);
  const busy = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const generate = useCallback((): void => {
    if (busy.current) return;
    busy.current = true;
    setStatus("waiting");
    void makeCandidates(talkId).then((result) => {
      if (!live.current) return;
      busy.current = false;
      if (!result.ok) {
        setStatus("failed");
        return;
      }
      setCandidates(result.value.candidates);
      setStatus("ready");
    });
  }, [talkId]);
  useEffect(() => {
    if (!eligible || asked.current) return;
    asked.current = true;
    generate();
  }, [eligible, generate]);

  return {
    status,
    candidates,
    selected,
    adding,
    addFailed,
    retry: generate,
    toggle(index) {
      if (
        busy.current ||
        !candidates.some((candidate) => candidate.index === index && !candidate.added)
      )
        return;
      setSelected((last) =>
        last.includes(index)
          ? last.filter((value) => value !== index)
          : [...last, index],
      );
    },
    add() {
      if (busy.current || selected.length === 0) return;
      busy.current = true;
      setAdding(true);
      setAddFailed(false);
      void addTalkCards(talkId, selected).then((result) => {
        if (!live.current) return;
        busy.current = false;
        setAdding(false);
        if (!result.ok) {
          setAddFailed(true);
          return;
        }
        const rows = result.value.candidates;
        setCandidates(rows);
        setSelected((last) =>
          last.filter((index) => rows.some((row) => row.index === index && !row.added)),
        );
        void cache.invalidateQueries({ queryKey: ["vocab"] });
      });
    },
  };
}
