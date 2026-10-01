import {
  isClosing,
  type Judgment,
  type Scene,
  type Talk,
  type Turn,
} from "@instant-composition/domain";

/** What `startTalk` answers: the scene and the partner's opening line. */
export interface TalkOpened {
  readonly talkId: string;
  readonly scene: Scene;
  readonly opening: string;
}

/** The partner's reply to a turn; `closing` on the last turn's. */
export interface PartnerReply {
  readonly line: string;
  readonly closing: boolean;
}

/** What `sendTurn` answers: the judgment, and the reply when its call succeeded. */
export interface TurnResult {
  readonly judgment: Judgment;
  readonly reply: PartnerReply | null;
}

/** What `endTalk` answers: whether the talk is kept as a record. */
export interface TalkEnded {
  readonly kept: boolean;
}

export function openedOf(talk: Talk): TalkOpened {
  return { talkId: talk.id, scene: talk.scene, opening: talk.opening };
}

export function turnResultOf(turn: Turn): TurnResult {
  return {
    judgment: turn.judgment,
    reply:
      turn.reply === undefined ? null : { line: turn.reply, closing: isClosing(turn) },
  };
}
