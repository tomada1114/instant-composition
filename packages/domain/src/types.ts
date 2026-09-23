/** A practice day, `YYYY-MM-DD`, shifted by the day boundary. Only `day.ts` makes one. */
export type DayKey = string;

/** How the learner graded a card, or `timeout` when the timer ran out first. */
export type AnswerResult = "ok" | "ng" | "timeout";

/** The first pass through a round's deck, or the retry of what it missed. */
export type Pass = "first" | "retry";

/** What a round is for; see `compose.ts` and `placement.ts` for how each is built. */
export type RoundKind = "placement" | "today" | "yesterday" | "extra";

/** The fields of a card every rule reads. */
export interface CardMeta {
  readonly id: string;
  readonly topic: string;
  readonly subtopic: string;
  readonly level: number;
  readonly words: number;
}

/** A card as the drill shows it, with its prompt and explanation in the learner's first language. */
export interface CardContent extends CardMeta {
  readonly prompt: string;
  /** The model answer, in the target language. */
  readonly text: string;
  readonly alternatives: readonly string[];
  readonly explanation: string;
}

/**
 * A card an answer may still name although it is not shown: deleted, or edited
 * since its review. Neither carries the text of an unreviewed edit.
 */
export interface RetiredCard {
  readonly id: string;
  readonly topic: string;
  readonly subtopic: string;
  readonly level: number;
  /** Null for a deleted card, whose limit falls back to the shortest. */
  readonly words: number | null;
  /** The prompt as deleted; null for an edited card, whose reviewed prompt is gone. */
  readonly prompt: string | null;
}

/** One graded card, as stored. */
export interface AnswerRecord {
  /** Made by the client; a repeated id is ignored, which is what makes a resend safe. */
  readonly id: string;
  readonly roundId: string;
  readonly cardId: string;
  readonly pass: Pass;
  readonly result: AnswerResult;
  /** Until the flip; `limitMs` for a timeout. */
  readonly elapsedMs: number;
  readonly limitMs: number;
  /** The round's day, not the wall-clock day of the answer. */
  readonly day: DayKey;
  readonly answeredAt: number;
  /** Copied at answer time: the last trace of a card that is later deleted. */
  readonly topic: string;
  readonly subtopic: string;
  readonly level: number;
  readonly prompt: string | null;
}

/** Where a card sits in the Leitner boxes, derived from its first-pass answers. */
export interface CardState {
  readonly box: number;
  readonly dueDay: DayKey;
  readonly lastDay: DayKey;
  readonly seenCount: number;
}

export interface SubtopicRef {
  readonly topic: string;
  readonly subtopic: string;
}

export type DailySize = 5 | 10 | 15 | 20 | 30;

export interface Settings {
  readonly topics: readonly string[];
  readonly focus: readonly SubtopicRef[];
  readonly dailySize: DailySize;
  readonly sound: boolean;
}

/** A top-level topic and its subtopics, in `content/taxonomy.json`'s order. */
export interface TopicInfo {
  readonly id: string;
  /** In the learner's first language. */
  readonly name: string;
  readonly subtopics: readonly { readonly id: string; readonly name: string }[];
}
