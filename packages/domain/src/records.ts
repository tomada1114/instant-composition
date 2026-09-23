import type { DifficultyAnswer } from "./difficulty";
import type { Growth, ReviewRow } from "./growth";
import type { Dot } from "./streak";
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
  readonly prompt: string;
}

/** A scale every activity maps onto, and a spaced-repetition scheduler reads. */
export type Outcome = "again" | "good" | "easy";

/** What only a composition review has. */
export interface CompositionDetail {
  readonly activity: "composition";
  readonly pass: Pass;
  readonly result: AnswerResult;
  /** Until the flip; `limitMs` for a timeout. */
  readonly elapsedMs: number;
  readonly limitMs: number;
}

/** One entry of the review log. Never updated once written. */
export interface ReviewEntry {
  /** Made by the client; a repeated id is ignored, which is what makes a resend safe. */
  readonly id: string;
  readonly item: ItemRef;
  /** The round, or another activity's session. */
  readonly sessionId: string;
  readonly answeredAt: number;
  /** The session's practice day, not the wall-clock day of the answer. */
  readonly day: DayKey;
  readonly outcome: Outcome;
  /** The item's memory state around this review; a retry leaves it unchanged. */
  readonly before: CardState | null;
  readonly after: CardState | null;
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

/** One item's projection: its memory state and what mastery and growth read. */
export interface ItemProgress {
  readonly item: ItemRef;
  readonly memory: CardState;
  /** Distinct days of a correct first pass, oldest first, never more than two. */
  readonly okDays: readonly DayKey[];
  readonly mastered: { readonly day: DayKey; readonly sessionId: string } | null;
  /** The placement on the latest review, for an item the catalog no longer holds. */
  readonly placement: SubtopicRef;
  readonly last: FirstPassMark | null;
  /** The latest first pass from a session before `last`'s. */
  readonly previous: FirstPassMark | null;
}

export type LevelReason = "placement" | "up" | "down";

export interface LevelEntry {
  readonly level: number;
  readonly reason: LevelReason;
  readonly roundId: string | null;
  readonly at: number;
}

/** Everything a finished round's summary shows that the catalog does not supply. */
export interface RoundOutcome {
  readonly placement: { readonly level: number; readonly first: boolean } | null;
  readonly difficulty: {
    readonly change: "up" | "down";
    readonly level: number;
  } | null;
  readonly growth: Growth;
  readonly review: readonly ReviewRow[];
  readonly streak: {
    readonly value: number;
    readonly restart: boolean;
    readonly changed: boolean;
  };
  readonly week: readonly Dot[];
  readonly filled: DayKey | null;
  /** Mastered items per topic after the round, and how many the round added. */
  readonly reach: readonly {
    readonly topic: string;
    readonly count: number;
    readonly added: number;
  }[];
  readonly titles: readonly string[];
  readonly points: { readonly earned: number; readonly total: number };
  readonly totals: {
    readonly said: number;
    readonly practicedDays: number;
    readonly last14: readonly { readonly day: DayKey; readonly count: number }[];
    readonly added: number;
  };
  readonly portionCompleted: boolean;
  readonly todayOpen: boolean;
  readonly continueToday: boolean;
}

export interface Round {
  readonly id: string;
  readonly kind: RoundKind;
  readonly day: DayKey;
  /** The day whose portion this round counts toward, or null for an extra round. */
  readonly portionDay: DayKey | null;
  /** Item ids of the first pass, in the order they are shown. */
  readonly deck: readonly string[];
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly abandonedAt: number | null;
  /** First-pass answers taken so far. */
  readonly firstPass: number;
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
  readonly completedDays: readonly DayKey[];
  readonly firstDay: DayKey | null;
  readonly said: number;
  readonly practicedDays: number;
  readonly level: LevelEntry | null;
  /** First-pass answers since the level last changed, the newest `TUNING.difficulty.window`. */
  readonly levelWindow: readonly DifficultyAnswer[];
  /** A learner has at most one round open at a time. */
  readonly openRound: { readonly id: string; readonly day: DayKey } | null;
  /** Title keys in the order they were awarded. */
  readonly titles: readonly string[];
}
