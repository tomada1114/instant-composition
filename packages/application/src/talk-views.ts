import {
  isClosing,
  TALK_TUNING,
  type Judgment,
  type Scene,
  type Talk,
  type Turn,
} from "@instant-composition/domain";

import type { VocabCategory } from "./vocab-item";

/** What `startTalk` answers: the scene and the partner's opening line. */
export interface TalkOpened {
  readonly talkId: string;
  readonly scene: Scene;
  readonly opening: string;
  /** Turns the client shows and follows for this talk. */
  readonly turnCount: number;
}

/** A stored talk's public view, without model metadata or recital counters. */
export interface TalkView extends TalkOpened {
  readonly status: Talk["status"];
  readonly turns: readonly {
    readonly turn: number;
    readonly japanese: string;
    readonly english: string | null;
    readonly judgment: Judgment;
    readonly reply: string | null;
    readonly closing: boolean;
  }[];
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
  return {
    talkId: talk.id,
    scene: talk.scene,
    opening: talk.opening,
    turnCount: TALK_TUNING.turns,
  };
}

export function turnResultOf(turn: Turn): TurnResult {
  return {
    judgment: turn.judgment,
    reply:
      turn.reply === undefined ? null : { line: turn.reply, closing: isClosing(turn) },
  };
}

/** One card a talk's end offers, as the learner picks it. */
export interface CardCandidateView {
  /** What `addCards` names it by: its place in the list. */
  readonly index: number;
  /** The corrected turn it came from. */
  readonly turn: number;
  /**
   * The card it is answered as — a catalog card or one of the learner's own
   * holding the same headword — or the card it became once added; null for a
   * new one not added yet.
   */
  readonly cardId: string | null;
  /** The text below is a catalog card's, not the model's. */
  readonly catalog: boolean;
  readonly category: VocabCategory;
  readonly headword: string;
  readonly definition: string;
  readonly example: string;
  readonly example2: string;
  readonly meaning: string;
  /** Its card has been answered at least once: 学習中. */
  readonly inLearning: boolean;
  /** Added from this talk: 追加済み. */
  readonly added: boolean;
}

/** What `makeCandidates` and `addCards` answer: the talk's candidates, in order. */
export interface CardCandidates {
  readonly candidates: readonly CardCandidateView[];
}
