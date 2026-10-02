import type { TalkView } from "../openapi";
import { revealReply, type Talk, type TalkTurn } from "./talk-state";

/** Restores kept feedback, skipping the interrupted recital and showing the latest reply. */
export function resumedTalk(view: TalkView): Talk {
  const turns: TalkTurn[] = view.turns.map((turn, index) => ({
    n: turn.turn,
    partnerLine: view.turns[index - 1]?.reply ?? view.opening,
    japanese: turn.japanese,
    english: turn.english,
    judgment: turn.judgment,
    reply: turn.reply === null ? null : { line: turn.reply, closing: turn.closing },
    revealCount: 0,
  }));
  const talk: Talk = {
    talkId: view.talkId,
    scene: view.scene,
    turns:
      turns.length === 0
        ? [{ n: 1, partnerLine: view.opening, revealCount: 0 }]
        : turns,
    step: "japanese",
  };
  return turns.length === 0 ? talk : revealReply(talk);
}
