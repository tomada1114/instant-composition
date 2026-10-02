import { useEffect, useReducer, useState, type Dispatch } from "react";

import { getTalk } from "../lib/talk-endpoints";
import { forgetTalk, readTalkId } from "../lib/talk-storage";
import { resumedTalk } from "./talk-resume";
import { IDLE, talkReducer, type TalkEvent, type TalkState } from "./talk-state";

async function restore(
  talkId: string,
  dispatch: Dispatch<TalkEvent>,
  current: () => boolean,
): Promise<void> {
  const result = await getTalk(talkId);
  if (!current()) return;
  if (result.ok && result.value.status === "open") {
    dispatch({ type: "resumed", talk: resumedTalk(result.value) });
  } else if (!result.ok && result.error.code !== "ERR_TALK_NOT_FOUND") {
    dispatch({ type: "startFailed" });
  } else {
    forgetTalk(talkId);
    dispatch({ type: "resumeMissing" });
  }
}

/** Reads an id on mount before W2 appears; a failed read retries that same talk. */
export function useTalkState(): {
  state: TalkState;
  dispatch: Dispatch<TalkEvent>;
  resume: () => boolean;
} {
  const [savedId] = useState(readTalkId);
  const [state, dispatch] = useReducer(
    talkReducer,
    savedId === undefined ? IDLE : { kind: "preparing" },
  );
  useEffect(() => {
    if (savedId === undefined) return undefined;
    let current = true;
    void restore(savedId, dispatch, () => current);
    return () => {
      current = false;
    };
  }, [savedId]);
  function resume(): boolean {
    if (state.kind !== "failed" || savedId === undefined) return false;
    const talkId = readTalkId();
    if (talkId === undefined) return false;
    dispatch({ type: "start" });
    void restore(talkId, dispatch, () => true);
    return true;
  }
  return { state, dispatch, resume };
}
