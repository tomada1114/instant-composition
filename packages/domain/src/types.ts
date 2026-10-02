/** A practice day, `YYYY-MM-DD`, shifted by the day boundary. Only `day.ts` makes one. */
export type DayKey = string;

/**
 * What an answer counts as in the drill's figures: `ok` said in time (graded
 * hard or good before the timer ran out), `ng` graded again, `timeout` the
 * timer ran out first, whatever the grade. An older client sends it in place
 * of a grade; see `gradedOf`.
 */
export type AnswerResult = "ok" | "ng" | "timeout";

/** A card's first showing in a round, or a re-ask of it later in the round. */
export type Pass = "first" | "retry";

/** What a round is for; see `compose.ts` and `placement.ts` for how each is built. */
export type RoundKind = "placement" | "today" | "yesterday" | "extra";

/** A concept namespaced by its target language, such as `en:grammar/present-perfect`. */
export type ConceptId = string;

/** The fields of a card every rule reads. */
export interface CardMeta {
  readonly id: string;
  readonly topic: string;
  readonly subtopic: string;
  readonly level: number;
  readonly words: number;
  /** What the model answer practises, such as `en:grammar/present-perfect`. */
  readonly concepts: readonly ConceptId[];
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
  /** Null for a deleted card, whose pace falls back to the shortest. */
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

/**
 * Where a card sat in the Leitner boxes the drill scheduled with before FSRS.
 * Items and reviews logged then keep it; nothing schedules by it any more.
 */
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

/** A per-card time limit on offer, in seconds; `TUNING.limitSeconds` lists them. */
export type LimitSeconds = 15 | 20 | 30 | 45 | 60;

/**
 * The keys the drill grades a flipped card with, as `KeyboardEvent.code`
 * values, so a choice holds whatever the keyboard layout or input method.
 * `isGradeKeyPair` says which keys are allowed.
 */
export interface GradeKeys {
  /** ○ 覚えてた, good. */
  readonly ok: string;
  /** × 忘れた, again. */
  readonly ng: string;
  /** △ 微妙, hard. Absent in a pair stored before three grades: `gradeKeysOf` derives it. */
  readonly hard?: string;
}

/** New drill cards a day may bring; `TUNING.newPerDay` lists them. */
export type DrillNewPerDay = 0 | 3 | 5 | 10 | 15;

/** Drill reviews a day may bring, `null` for no limit; `TUNING.reviewsPerDay` lists them. */
export type DrillReviewsPerDay = 10 | 20 | 30 | 50 | null;

/** New vocabulary cards a day may bring; `VOCAB_TUNING.newPerDay` lists them. */
export type VocabNewPerDay = 0 | 5 | 10 | 15 | 20 | 30;

/** Vocabulary reviews a day may bring, `null` for no limit; `VOCAB_TUNING.reviewsPerDay` lists them. */
export type VocabReviewsPerDay = 50 | 100 | 200 | null;

export interface Settings {
  readonly topics: readonly string[];
  readonly focus: readonly SubtopicRef[];
  /** Read and written for the clients that still show it; it no longer sizes a deal. */
  readonly dailySize: DailySize;
  readonly sound: boolean;
  /**
   * Absent until the learner chooses one, stored settings from before the
   * limit was a setting included, so `TUNING.defaultLimitSeconds` stands in.
   */
  readonly limitSeconds?: LimitSeconds;
  /** Absent until the learner chooses keys, so `TUNING.defaultGradeKeys` stands in. */
  readonly gradeKeys?: GradeKeys;
  /** Absent until the learner chooses one, so `TUNING.defaultNewPerDay` stands in. */
  readonly newPerDay?: DrillNewPerDay;
  /** Absent until the learner chooses one, so `TUNING.defaultReviewsPerDay` stands in. */
  readonly reviewsPerDay?: DrillReviewsPerDay;
  /** Absent until the learner chooses one, so `VOCAB_TUNING.defaultNewPerDay` stands in. */
  readonly vocabNewPerDay?: VocabNewPerDay;
  /** Absent until the learner chooses one, so `VOCAB_TUNING.defaultReviewsPerDay` stands in. */
  readonly vocabReviewsPerDay?: VocabReviewsPerDay;
}

/** A top-level topic and its subtopics, in `content/taxonomy.json`'s order. */
export interface TopicInfo {
  readonly id: string;
  /** In the learner's first language. */
  readonly name: string;
  readonly subtopics: readonly { readonly id: string; readonly name: string }[];
}
