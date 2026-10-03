import { useEffect, useRef, useState } from "react";

import { browserSound } from "../drill/sound";
import type { ApiError } from "../lib/api-call";
import { TUNING } from "../lib/tuning";
import { forgetTalk, rememberTalk } from "../lib/talk-storage";
import { useTalkState } from "./use-talk-state";
import {
  endTalk,
  recordRecital,
  retryReply,
  sendTurn,
  startTalk,
} from "../lib/talk-endpoints";
import { currentTurn, type Talk, type TalkState } from "./talk-state";

import type { TalkActions, TalkNotice } from "./talk-actions";
export type { TalkActions, TalkNotice } from "./talk-actions";

/**
 * The talk's state and the calls each step makes. Every answer names the
 * talk it was asked for, so one that arrives after the talk ended or a new
 * one began changes nothing.
 */
export function useTalk(sound: boolean): {
  state: TalkState;
  notice: TalkNotice;
  actions: TalkActions;
  kept: boolean;
} {
  const { state, dispatch, resume } = useTalkState();
  const [notice, setNotice] = useState<TalkNotice>({ signal: 0, kind: "judgment" });
  const [keptId, setKeptId] = useState<string>();
  const startRequest = useRef<string | undefined>(undefined);
  useEffect(
    () => () => {
      startRequest.current = undefined;
    },
    [],
  );

  function tell(kind: TalkNotice["kind"]): void {
    setNotice((last) => ({ signal: last.signal + 1, kind }));
  }

  function talk(): Talk | undefined {
    return state.kind === "talk" ? state.talk : undefined;
  }

  /** A talk the server no longer has (404) or has closed (409) ends here: W3h, never W3g's 「もう一度」. */
  function failed(
    talkId: string,
    error: ApiError,
    otherwise: "turnFailed" | "replyFailed",
  ): void {
    if (error.code !== "ERR_TALK_NOT_FOUND" && error.code !== "ERR_TALK_CLOSED") {
      dispatch({ type: otherwise, talkId });
      return;
    }
    dispatch({ type: "gone", talkId });
    // An expired or unknown talk was never kept; a closed one was, by whatever closed it.
    if (error.code === "ERR_TALK_NOT_FOUND") tell("save");
    else setKeptId(talkId);
  }

  async function send(
    talkId: string,
    n: number,
    japanese: string,
    english: string | null,
  ): Promise<void> {
    const result = await sendTurn(talkId, { turn: n, japanese, english });
    if (!result.ok) {
      failed(talkId, result.error, "turnFailed");
      return;
    }
    if (result.value.judgment.verdict === "failed") tell("judgment");
    dispatch({ type: "answered", talkId, result: result.value });
  }

  async function askReply(talkId: string): Promise<void> {
    const result = await retryReply(talkId);
    if (!result.ok) {
      failed(talkId, result.error, "replyFailed");
      return;
    }
    dispatch({ type: "replied", talkId, reply: result.value });
  }

  const step = state.kind === "talk" ? state.talk.step : undefined;
  const turnNumber = state.kind === "talk" ? currentTurn(state.talk).n : 0;
  const talkId = state.kind === "talk" ? state.talk.talkId : undefined;
  useEffect(() => {
    if (step !== "fine" || talkId === undefined) return undefined;
    if (sound) browserSound.play("ok");
    const timer = setTimeout(() => {
      dispatch({ type: "shown", talkId });
    }, TUNING.feedbackMaxMs);
    return () => {
      clearTimeout(timer);
    };
  }, [step, turnNumber, talkId, sound, dispatch]);

  useEffect(() => {
    if (step === "ended" && talkId !== undefined) forgetTalk(talkId);
  }, [step, talkId]);

  const actions: TalkActions = {
    start() {
      if (sound) browserSound.unlock();
      if (resume()) return;
      setKeptId(undefined);
      dispatch({ type: "start" });
      const request = crypto.randomUUID();
      startRequest.current = request;
      void startTalk(request).then((result) => {
        if (startRequest.current !== request) return;
        if (result.ok) rememberTalk(result.value.talkId);
        dispatch(
          result.ok
            ? { type: "opened", opened: result.value }
            : { type: "startFailed" },
        );
      });
    },
    japanese(text) {
      dispatch({ type: "japanese", text });
    },
    english(text) {
      const now = talk();
      if (now === undefined) return;
      if (sound) browserSound.unlock();
      const turn = currentTurn(now);
      dispatch({ type: "english", text });
      void send(now.talkId, turn.n, turn.japanese ?? "", text);
    },
    hide() {
      dispatch({ type: "hide" });
    },
    lookAgain() {
      dispatch({ type: "lookAgain" });
    },
    said() {
      const now = talk();
      if (now?.step !== "hidden") return;
      const turn = currentTurn(now);
      void recordRecital(now.talkId, turn.n, turn.revealCount);
      dispatch({ type: "said" });
    },
    retry() {
      const now = talk();
      if (now === undefined) return;
      const turn = currentTurn(now);
      dispatch({ type: "retrying", talkId: now.talkId });
      if (now.step === "turnFailed") {
        void send(now.talkId, turn.n, turn.japanese ?? "", turn.english ?? null);
      } else if (now.step === "replyFailed") {
        void askReply(now.talkId);
      }
    },
    end(stay) {
      const now = talk();
      if (now === undefined) return;
      forgetTalk(now.talkId);
      if (stay) dispatch({ type: "end" });
      void endTalk(now.talkId).then((result) => {
        if (!result.ok && stay) tell("save");
        if (result.ok && result.value.kept && stay) setKeptId(now.talkId);
      });
    },
  };

  return {
    state,
    notice,
    actions,
    kept:
      talkId !== undefined &&
      (keptId === talkId || (state.kind === "talk" && state.talk.closed === true)),
  };
}
