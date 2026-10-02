import type { Grade, Pass } from "../openapi";

/**
 * The state of one round in the browser, and what can be read off it. The
 * reducer that moves it is `drill-machine.ts`; which card comes next is
 * `re-asks.ts`.
 */

/** How a back was reached: flipped by the learner, or by the timer running out. */
export type BackMode = "self" | "timeout";

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
      readonly mode: BackMode;
      readonly elapsedMs: number;
      /** When the back appeared, for the grade-key lock. */
      readonly since: number;
    }
  | {
      readonly kind: "feedback";
      readonly mode: BackMode;
      readonly grade: Grade;
      readonly fast: boolean;
      readonly elapsedMs: number;
    }
  | { readonly kind: "finishing" };

/**
 * `at` is on the page's monotonic clock, which times the card. A grade also
 * carries `wall`, the same moment on the wall clock in epoch ms, which the
 * answer reports as the time it was given.
 */
export type DrillEvent =
  | {
      readonly type: "start" | "shown" | "tick" | "flip" | "advance";
      readonly at: number;
    }
  | { readonly type: "pause" | "hide" | "resume"; readonly at: number }
  | {
      readonly type: "grade";
      readonly grade: Grade;
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
  readonly grade: Grade;
  /** The timer ran out before the flip; the grade still sets the schedule. */
  readonly timedOut: boolean;
  readonly elapsedMs: number;
  /** Epoch ms on the wall clock; one stored by an earlier build of the queue may lack it. */
  readonly answeredAt?: number;
}

/** The card on screen: its first pass (`ask` 0), or its `ask`th re-ask. */
export interface ShownCard {
  readonly cardId: string;
  readonly pass: Pass;
  readonly ask: number;
}

/** A card waiting to come back, once the session has shown `due` cards. */
export interface ReAsk {
  readonly cardId: string;
  readonly due: number;
}

export interface DrillInit {
  readonly roundId: string;
  readonly deck: readonly string[];
  /** Each card's time limit: the one the round was dealt with. */
  readonly limits: Readonly<Record<string, number>>;
  /** Each card's pace, which "fast" is judged by rather than the limit. */
  readonly paces: Readonly<Record<string, number>>;
  /** The cards new to the learner, which come back once more after their first ○. */
  readonly isNew: Readonly<Record<string, boolean>>;
  readonly answered: readonly { readonly cardId: string; readonly pass: Pass }[];
  /** Whether misses come back in the session; a placement round has none. */
  readonly retries: boolean;
  readonly intro: boolean;
}

export interface DrillState {
  readonly roundId: string;
  readonly retries: boolean;
  readonly limits: Readonly<Record<string, number>>;
  readonly paces: Readonly<Record<string, number>>;
  readonly isNew: Readonly<Record<string, boolean>>;
  /** First-pass cards not shown yet, in the deck's order. */
  readonly fresh: readonly string[];
  /** First passes shown in the round, the one on screen and those before this session included. */
  readonly firstShown: number;
  readonly card: ShownCard | undefined;
  /** Re-asks waiting, in the order they were set. */
  readonly reAsks: readonly ReAsk[];
  /** Cards shown in this session, the one on screen included. */
  readonly step: number;
  /** Re-asks shown so far, per card. */
  readonly asked: Readonly<Record<string, number>>;
  /** ○ grades given so far in this session, per card. */
  readonly goods: Readonly<Record<string, number>>;
  readonly combo: number;
  readonly paused: boolean;
  /** Answers given in this session, oldest first. */
  readonly answers: readonly AnswerInput[];
  readonly phase: DrillPhase;
}

/**
 * Fixed by round, card and which showing of it this is, so resending an
 * answer cannot store it twice: `f` for the first pass, `r<n>` for the nth
 * re-ask. A reload drops waiting re-asks, so a card's re-asks all come in the
 * session of its first pass and never reuse an id.
 */
export function answerId(roundId: string, cardId: string, ask: number): string {
  return `${roundId}:${ask === 0 ? "f" : `r${String(ask)}`}:${cardId}`;
}

export const FRESH_FRONT: DrillPhase = {
  kind: "front",
  spentMs: 0,
  runningSince: null,
  now: null,
};

export function currentCard(state: DrillState): ShownCard | undefined {
  return state.phase.kind === "finishing" ? undefined : state.card;
}

/**
 * Where the drill stands: first passes counted to the one on screen (or the
 * last one shown, during a re-ask), out of all of them, and the re-asks
 * still waiting.
 */
export function progress(state: DrillState): {
  readonly position: number;
  readonly total: number;
  readonly waiting: number;
} {
  return {
    position: state.firstShown,
    total: state.firstShown + state.fresh.length,
    waiting: state.reAsks.length,
  };
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
