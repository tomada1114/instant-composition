import type { AnswerResult, Pass } from "../openapi";

/**
 * The state of one round in the browser, and what can be read off it. The
 * reducer that moves it is `drill-machine.ts`.
 */

export type DrillPhase =
  | { readonly kind: "intro" }
  | {
      readonly kind: "front";
      /** Time used before the current run of the clock. */
      readonly spentMs: number;
      /** When the clock last started; `null` until the front is drawn, and while paused. */
      readonly runningSince: number | null;
      readonly now: number | null;
    }
  | {
      readonly kind: "back";
      readonly mode: "self" | "timeout";
      readonly elapsedMs: number;
      /** When the back appeared, for the grade-key lock. */
      readonly since: number;
      /** What the learner typed in a typed round, when they typed anything. */
      readonly text?: string;
    }
  | {
      readonly kind: "feedback";
      readonly result: "ok" | "ng";
      readonly fast: boolean;
      readonly elapsedMs: number;
      readonly text?: string;
    }
  | { readonly kind: "finishing" };

/**
 * `at` is on the page's monotonic clock, which times the card. An event that
 * can record an answer also carries `wall`, the same moment on the wall clock
 * in epoch ms, which the answer reports as the time it was given.
 */
export type DrillEvent =
  | { readonly type: "start" | "shown" | "next"; readonly at: number }
  | { readonly type: "tick" | "flip"; readonly at: number; readonly wall: number }
  | { readonly type: "advance" | "pause" | "hide" | "resume"; readonly at: number }
  | { readonly type: "submit"; readonly text: string; readonly at: number }
  | {
      readonly type: "grade";
      readonly result: "ok" | "ng";
      readonly at: number;
      readonly wall: number;
      /** A key is locked out for a moment after the flip; a pressed button is not. */
      readonly key: boolean;
    };

/** One graded card, as the drill keeps it until it is sent: the batch body's answer and its round. */
export interface AnswerInput {
  readonly id: string;
  readonly roundId: string;
  readonly cardId: string;
  readonly pass: Pass;
  readonly result: AnswerResult;
  readonly elapsedMs: number;
  /** Epoch ms on the wall clock; one stored by an earlier build of the queue may lack it. */
  readonly answeredAt?: number;
  readonly text?: string;
}

/** A typed card's answer submitted but not yet graded, which a resumed round opens on. */
export interface Submission {
  readonly cardId: string;
  readonly pass: Pass;
  readonly elapsedMs: number;
  readonly text?: string;
}

export interface DrillInit {
  readonly roundId: string;
  readonly deck: readonly string[];
  /** Each card's time limit: the one the round was dealt with. */
  readonly limits: Readonly<Record<string, number>>;
  /** Each card's pace, which "fast" is judged by rather than the limit. */
  readonly paces: Readonly<Record<string, number>>;
  readonly answered: readonly {
    readonly cardId: string;
    readonly pass: Pass;
    readonly result: AnswerResult;
  }[];
  readonly retries: boolean;
  readonly intro: boolean;
  /** A typed round runs no clock out and takes each answer as text; spoken when absent. */
  readonly typed?: boolean;
  readonly submitted?: Submission | undefined;
}

export interface DrillState {
  readonly roundId: string;
  readonly retries: boolean;
  readonly typed: boolean;
  readonly limits: Readonly<Record<string, number>>;
  readonly paces: Readonly<Record<string, number>>;
  /** First-pass cards still to show when this session began. */
  readonly queue: readonly string[];
  readonly firstDone: number;
  /** Cards missed on the first pass, in the order they came. */
  readonly retryPile: readonly string[];
  readonly pass: Pass;
  /** Into `queue` on the first pass, into `retryPile` on the retry pass. */
  readonly index: number;
  readonly combo: number;
  readonly paused: boolean;
  /** Answers given in this session, oldest first. */
  readonly answers: readonly AnswerInput[];
  readonly phase: DrillPhase;
}

/** Fixed by round, pass and card, so resending an answer cannot store it twice. */
export function answerId(roundId: string, pass: Pass, cardId: string): string {
  return `${roundId}:${pass === "first" ? "f" : "r"}:${cardId}`;
}

export const FRESH_FRONT: DrillPhase = {
  kind: "front",
  spentMs: 0,
  runningSince: null,
  now: null,
};

export function currentCard(
  state: DrillState,
): { readonly cardId: string; readonly pass: Pass } | undefined {
  if (state.phase.kind === "finishing") return undefined;
  const cardId = (state.pass === "first" ? state.queue : state.retryPile)[state.index];
  return cardId === undefined ? undefined : { cardId, pass: state.pass };
}

/** Where the drill stands: the card being shown, counted from 1. */
export function progress(state: DrillState): {
  readonly pass: Pass;
  readonly position: number;
  readonly total: number;
} {
  return state.pass === "first"
    ? {
        pass: "first",
        position: state.firstDone + state.index + 1,
        total: state.firstDone + state.queue.length,
      }
    : { pass: "retry", position: state.index + 1, total: state.retryPile.length };
}

export function limitOf(state: DrillState): number {
  const card = currentCard(state);
  return card === undefined ? 0 : (state.limits[card.cardId] ?? 0);
}

export function paceOf(state: DrillState): number {
  const card = currentCard(state);
  return card === undefined ? 0 : (state.paces[card.cardId] ?? 0);
}

export function usedMs(
  phase: Extract<DrillPhase, { kind: "front" }>,
  at: number,
): number {
  return phase.spentMs + (phase.runningSince === null ? 0 : at - phase.runningSince);
}

/** Time left on the front, as of the last event; `undefined` off a front. */
export function remainingMs(state: DrillState): number | undefined {
  const { phase } = state;
  if (phase.kind !== "front" && phase.kind !== "intro") return undefined;
  if (phase.kind === "intro") return limitOf(state);
  return Math.max(
    0,
    limitOf(state) - usedMs(phase, phase.now ?? phase.runningSince ?? 0),
  );
}
