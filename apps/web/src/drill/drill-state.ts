import { currentCard, usedMs, type StudyState } from "../study/study-state";
import type { Pass } from "../openapi";

export {
  answerId,
  currentCard,
  progress,
  FRESH_FRONT,
  usedMs,
  type AnswerInput,
  type ReAsk,
  type ShownCard,
  type StudyPhase as DrillPhase,
  type StudyEvent as DrillEvent,
} from "../study/study-state";

export interface DrillInit {
  readonly roundId: string;
  readonly deck: readonly string[];
  /** Each card's time limit: the one the round was dealt with. */
  readonly limits: Readonly<Record<string, number>>;
  /** Each card's API threshold for a fast flip, independent of the limit. */
  readonly fastThresholds: Readonly<Record<string, number>>;
  /** The cards new to the learner, which come back once more after their first ○. */
  readonly isNew: Readonly<Record<string, boolean>>;
  readonly answered: readonly { readonly cardId: string; readonly pass: Pass }[];
  /** Whether misses come back in the session; a placement round has none. */
  readonly retries: boolean;
  readonly intro: boolean;
}

/** Timed drill state extends only the shared session, with pace and combo owned here. */
export interface DrillState extends StudyState {
  readonly limits: Readonly<Record<string, number>>;
  readonly fastThresholds: Readonly<Record<string, number>>;
  readonly combo: number;
}

export function limitOf(state: DrillState): number {
  const card = currentCard(state);
  return card === undefined ? 0 : (state.limits[card.cardId] ?? 0);
}

export function fastThresholdOf(state: DrillState): number {
  const card = currentCard(state);
  return card === undefined ? 0 : (state.fastThresholds[card.cardId] ?? 0);
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
