import type { DifficultyAnswer } from "./difficulty";
import type { FsrsGrade, FsrsState } from "./fsrs";
import type { RoundOutcome } from "./round-outcome";
import type {
  AnswerResult,
  CardState,
  DayKey,
  Pass,
  RoundKind,
  SubtopicRef,
} from "./types";
/**
 * What a learner's history is kept as: one append-only log of reviews, and the
 * state a command maintains beside it so that no read replays the log.
 */
/** An item another context can point at; vocabulary adds its own `kind`. */
export interface ItemRef {
  readonly kind: "composition";
  readonly id: string;
}

/** The item as it was when reviewed, so the entry outlives an item later deleted. */
export interface ItemSnapshot {
  readonly topic: string;
  readonly subtopic: string;
  readonly level: number;
  /** Null when the item had been edited since its review, so no reviewed prompt was known. */
  readonly prompt: string | null;
}

/**
 * A scale every activity maps onto: an FSRS grade since the drill took three,
 * and `easy` on a review logged before, a fast correct answer then.
 */
export type Outcome = "again" | "hard" | "good" | "easy";

/** What only a composition review has. */
export interface CompositionDetail {
  readonly activity: "composition";
  readonly pass: Pass;
  /** What the figures count it as, from the grade and `timedOut`; see `resultOf`. */
  readonly result: AnswerResult;
  /** Absent on a review logged before three grades; `gradeOf` reads it from `result`. */
  readonly grade?: FsrsGrade;
  /** Absent where `grade` is: `result` says it then. */
  readonly timedOut?: boolean;
  /** Until the flip; `limitMs` for a timeout. */
  readonly elapsedMs: number;
  /** The round's limit, which the timer ran out at. */
  readonly limitMs: number;
  /** The card's pace, which "fast" is judged by; see `Paced` for an entry without one. */
  readonly paceMs?: number;
}

/** One entry of the review log. Never updated once written. */
export interface ReviewEntry {
  /** Made by the client; a repeated id is ignored, which is what makes a resend safe. */
  readonly id: string;
  readonly item: ItemRef;
  /** The round, or another activity's session. */
  readonly sessionId: string;
  readonly answeredAt: number;
  /** The item's causal revision when this review moves it; absent on legacy logs. */
  readonly revision?: number;
  /** The session's practice day, not the wall-clock day of the answer. */
  readonly day: DayKey;
  readonly outcome: Outcome;
  /**
   * The item's Leitner state around this review. A review logged before FSRS
   * moved it; a later one carries the state the item still holds, unchanged.
   */
  readonly before: CardState | null;
  readonly after: CardState | null;
  /**
   * The item's FSRS state around this review, absent on one logged before
   * FSRS. Only a card's first answer of a practice day moves it: a re-ask and
   * any later answer that day leave it as found, which is how a replay knows.
   */
  readonly fsrs?: {
    readonly before: FsrsState | null;
    readonly after: FsrsState | null;
  };
  readonly snapshot: ItemSnapshot;
  readonly detail: CompositionDetail;
}

/** A first-pass answer, as much of it as growth compares. */
export interface FirstPassMark {
  readonly sessionId: string;
  readonly result: AnswerResult;
  readonly elapsedMs: number;
  readonly answeredAt: number;
}

/** One item's projection: its schedule and what mastery and growth read. */
export interface ItemProgress {
  readonly item: ItemRef;
  /** Incremented with each state-changing review in the same atomic commit. */
  readonly revision?: number;
  /**
   * The Leitner state of an item seen before FSRS, kept as stored. Only its
   * presence is read: the item was seen then, so it is not new.
   */
  readonly memory?: CardState;
  /**
   * The schedule, from the item's first answer under FSRS. An item with Leitner
   * history and none is dealt as a review and scheduled as a new card.
   */
  readonly fsrs?: FsrsState;
  /** Distinct days of a correct first pass, oldest first, never more than two. */
  readonly okDays: readonly DayKey[];
  readonly mastered: { readonly day: DayKey; readonly sessionId: string } | null;
  /** The placement on the latest review, for an item the catalog no longer holds. */
  readonly placement: SubtopicRef;
  readonly last: FirstPassMark | null;
  /** The latest first pass from a session before `last`'s. */
  readonly previous: FirstPassMark | null;
}

/** Why the level last moved: measured, adjusted by the answers, or picked by hand. */
export type LevelReason = "placement" | "up" | "down" | "chosen";

/** Who moves the level: the answers (`auto`), or only the learner (`manual`). */
export type LevelMode = "auto" | "manual";

export interface LevelEntry {
  readonly level: number;
  readonly reason: LevelReason;
  readonly roundId: string | null;
  readonly at: number;
}

export interface Round {
  readonly id: string;
  readonly kind: RoundKind;
  readonly day: DayKey;
  /** The day whose portion this round counts toward, or null for an extra round. */
  readonly portionDay: DayKey | null;
  /** Item ids of the first pass, in the order they are shown. */
  readonly deck: readonly string[];
  /**
   * The per-card limit the round was dealt with, which its answers are held
   * to whatever the setting says later; see `limitMsOf` for a round without one.
   */
  readonly limitMs?: number;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly abandonedAt: number | null;
  /** First-pass answers taken so far. */
  readonly firstPass: number;
  /** Bounded adoption projection; an incomplete legacy load keeps its next log key. */
  readonly answerState?: {
    readonly firstCards: readonly string[];
    readonly cursor: string | null;
    readonly complete: boolean;
  };
  readonly outcome: RoundOutcome | null;
}

/** A practice day's portion, keyed by the day it is credited to. */
export interface Portion {
  readonly day: DayKey;
  readonly target: number;
  /** First-pass answers credited so far. */
  readonly progress: number;
  readonly completedAt: number | null;
  readonly completedRound: string | null;
}

/** Counts for one practice day. */
export interface DayTally {
  readonly day: DayKey;
  /** Every answer, retries included. */
  readonly answers: number;
  readonly firstPass: number;
  readonly roundsStarted: number;
  readonly roundsFinished: number;
  readonly lastFinishedRound: string | null;
}

/** The learner's totals, maintained on every commit that moves them. */
export interface LearnerStats {
  readonly points: number;
  /** Days whose portion was completed, oldest first. */
  readonly completedDays?: readonly DayKey[];
  /** Exact longest run; intervals and calendar portions hold the history separately. */
  readonly streak?: { readonly schema: 1; readonly longest: number };
  readonly firstDay: DayKey | null;
  readonly said: number;
  readonly practicedDays: number;
  readonly level: LevelEntry | null;
  /** Absent in stats stored before a level could be picked, all `auto`; see `levelModeOf`. */
  readonly levelMode?: LevelMode;
  /** First-pass answers since the level was placed or picked, the newest `TUNING.difficulty.window`. */
  readonly levelWindow: readonly DifficultyAnswer[];
  /** A learner has at most one round open at a time. */
  readonly openRound: { readonly id: string; readonly day: DayKey } | null;
  /** Title keys in the order they were awarded. */
  readonly titles: readonly string[];
}
