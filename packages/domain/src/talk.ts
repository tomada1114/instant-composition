import type { CardText } from "./vocab-card";

/**
 * The talk context's records: one talk per item, its turns inside it. A talk
 * is the consistency boundary every talk command reads and commits whole.
 */

/**
 * `open` while it runs; `finished` after its last turn and `ended` when the
 * learner ended it holding a turn, both kept for good; `discarded` when ended
 * holding none, left to expire like an `open` one.
 */
export type TalkStatus = "open" | "finished" | "ended" | "discarded";

/**
 * The model tasks a talk runs, each with its own prompt and version: the
 * scene, the teacher and the partner on every turn, and the card candidates
 * at its end.
 */
export type TalkTask = "talk-scene" | "talk-teacher" | "talk-partner" | "talk-cards";

/** Talking about yourself, or an errand or a small trouble. */
export type SceneKind = "self" | "errand";

/** Who the partner is, where, and how they are related; Japanese, as the model wrote it. */
export interface Scene {
  readonly partner: string;
  readonly place: string;
  readonly relation: string;
  /** One or two lines, shown above the talk. */
  readonly description: string;
}

/** `fine` is the ○; `failed` means the teacher's call produced nothing. */
export type Verdict = "fine" | "corrected" | "failed";

export interface Judgment {
  readonly verdict: Verdict;
  /** Empty unless `corrected`. */
  readonly modelAnswer: string;
  /** One line of Japanese naming the key phrase; empty unless `corrected`. */
  readonly point: string;
}

export interface Turn {
  /** 1 to `TALK_TUNING.turns`. */
  readonly n: number;
  /** The line this turn answers: the opening, or the previous turn's reply. */
  readonly partnerLine: string;
  readonly japanese: string;
  /** Null when the learner gave up. */
  readonly english: string | null;
  readonly judgment: Judgment;
  /** The partner's next line; absent while its call has not succeeded. The last turn's closes. */
  readonly reply?: string;
  /** How often the learner pressed "look again" during the recital. */
  readonly revealCount?: number;
}

/** Who served the talk and which prompt version each task ran at. */
export interface TalkModel {
  readonly provider: string;
  readonly modelId: string;
  /** As they stood when it started; a talk started before a task existed names none for it. */
  readonly prompts: Readonly<Partial<Record<TalkTask, string>>>;
}

/** A word or phrase a corrected turn offers as a vocabulary card, as the model wrote it. */
export interface CardCandidate extends CardText {
  /** The corrected turn it came from. */
  readonly turn: number;
}

/** A candidate the learner added, and the card it became or was matched to. */
export interface AddedCandidate {
  readonly index: number;
  readonly cardId: string;
}

/**
 * The candidates a kept talk's end offered: the first answer of its one
 * `talk-cards` call, kept so a resend answers them without another.
 */
export interface TalkCards {
  /** The `talk-cards` prompt version that produced them. */
  readonly promptVersion: string;
  /** In the order the model gave them; an index here is what the learner picks by. */
  readonly candidates: readonly CardCandidate[];
  /** In the order they were added, each index once. */
  readonly added: readonly AddedCandidate[];
}

export interface Talk {
  /** Made by the client, so a resent start cannot open two talks. */
  readonly id: string;
  readonly status: TalkStatus;
  /** Epoch milliseconds. */
  readonly startedAt: number;
  readonly endedAt?: number;
  /** Epoch seconds, the learner table's TTL attribute; absent once the talk is kept. */
  readonly expiresAt?: number;
  readonly scene: Scene;
  /** The partner's first line. */
  readonly opening: string;
  readonly turns: readonly Turn[];
  readonly model: TalkModel;
  /** Absent until the candidates are asked for, once the talk is kept. */
  readonly cards?: TalkCards;
}
