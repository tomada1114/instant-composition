import type { AnswerInput } from "./api";
import type { AnswerResult, Pass } from "./types";

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
    }
  | {
      readonly kind: "feedback";
      readonly result: "ok" | "ng";
      readonly fast: boolean;
      readonly elapsedMs: number;
    }
  | { readonly kind: "finishing" };

export type DrillEvent =
  | { readonly type: "start" | "shown" | "tick" | "flip" | "next"; readonly at: number }
  | { readonly type: "advance" | "pause" | "hide" | "resume"; readonly at: number }
  | {
      readonly type: "grade";
      readonly result: "ok" | "ng";
      readonly at: number;
      /** A key is locked out for a moment after the flip; a pressed button is not. */
      readonly key: boolean;
    };

export interface DrillInit {
  readonly roundId: string;
  readonly deck: readonly string[];
  readonly limits: Readonly<Record<string, number>>;
  readonly answered: readonly {
    readonly cardId: string;
    readonly pass: Pass;
    readonly result: AnswerResult;
  }[];
  readonly retries: boolean;
  readonly intro: boolean;
}

export interface DrillState {
  readonly roundId: string;
  readonly retries: boolean;
  readonly limits: Readonly<Record<string, number>>;
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

export function initDrill(init: DrillInit): DrillState {
  const shown = (id: string): boolean => init.limits[id] !== undefined;
  const first = init.answered.filter((a) => a.pass === "first");
  const answeredFirst = new Set(first.map((a) => a.cardId));
  const retryPile = init.retries
    ? first.filter((a) => a.result !== "ok" && shown(a.cardId)).map((a) => a.cardId)
    : [];
  const retryDone = init.answered.filter((a) => a.pass === "retry").length;
  const queue = init.deck.filter((id) => !answeredFirst.has(id) && shown(id));
  const base: DrillState = {
    roundId: init.roundId,
    retries: init.retries,
    limits: init.limits,
    queue,
    firstDone: first.length,
    retryPile,
    pass: "first",
    index: 0,
    combo: 0,
    paused: false,
    answers: [],
    phase: init.intro ? { kind: "intro" } : FRESH_FRONT,
  };
  if (queue.length > 0) return base;
  if (init.retries && retryDone < retryPile.length) {
    return { ...base, pass: "retry", index: retryDone, phase: FRESH_FRONT };
  }
  return { ...base, phase: { kind: "finishing" } };
}
