import { isFast, TUNING } from "../lib/tuning";
import type { AnswerResult } from "../openapi";
import {
  answerId,
  currentCard,
  FRESH_FRONT,
  limitOf,
  paceOf,
  usedMs,
  type DrillEvent,
  type DrillPhase,
  type DrillState,
} from "./drill-state";

/**
 * One round's progress in the browser, as a pure reducer: every event carries
 * the time it happened at, so the clock is an input, never read here.
 */

/** Moves to the next card, entering the retry pass or finishing when a pass runs out. */
function advance(state: DrillState): DrillState {
  if (state.pass === "first" && state.index + 1 < state.queue.length) {
    return { ...state, index: state.index + 1, phase: FRESH_FRONT };
  }
  const retryIndex = state.pass === "first" ? 0 : state.index + 1;
  if (state.retries && retryIndex < state.retryPile.length) {
    return { ...state, pass: "retry", index: retryIndex, phase: FRESH_FRONT };
  }
  return { ...state, phase: { kind: "finishing" } };
}

function record(
  state: DrillState,
  result: AnswerResult,
  elapsedMs: number,
  wall: number,
  text?: string,
): DrillState {
  const card = currentCard(state);
  if (card === undefined) return state;
  const missed = result !== "ok" && card.pass === "first" && state.retries;
  return {
    ...state,
    combo: result === "ok" ? state.combo + 1 : 0,
    retryPile: missed ? [...state.retryPile, card.cardId] : state.retryPile,
    answers: [
      ...state.answers,
      {
        id: answerId(state.roundId, card.pass, card.cardId),
        roundId: state.roundId,
        cardId: card.cardId,
        pass: card.pass,
        result,
        elapsedMs: Math.round(elapsedMs),
        answeredAt: wall,
        ...(text === undefined ? {} : { text }),
      },
    ],
  };
}

function timeout(state: DrillState, at: number, wall: number): DrillState {
  const limit = limitOf(state);
  const recorded = record(state, "timeout", limit, wall);
  return {
    ...recorded,
    phase: { kind: "back", mode: "timeout", elapsedMs: limit, since: at },
  };
}

/**
 * A typed front has no clock to run out: Enter turns it over with what was
 * typed, timed from the front being drawn and held to the round's cap. Text
 * that is only blank is not an answer's text.
 */
function onTypedFront(
  state: DrillState,
  phase: Extract<DrillPhase, { kind: "front" }>,
  event: DrillEvent,
): DrillState {
  if (event.type === "shown" && phase.runningSince === null)
    return { ...state, phase: { ...phase, runningSince: event.at, now: event.at } };
  if (event.type !== "submit" || phase.runningSince === null) return state;
  const text = event.text.trim();
  const back = {
    kind: "back",
    mode: "self",
    elapsedMs: Math.min(usedMs(phase, event.at), limitOf(state)),
    since: event.at,
  } as const;
  return { ...state, phase: text === "" ? back : { ...back, text } };
}

function onFront(
  state: DrillState,
  phase: Extract<DrillPhase, { kind: "front" }>,
  event: DrillEvent,
): DrillState {
  const running = phase.runningSince !== null;
  switch (event.type) {
    case "shown":
      return running
        ? state
        : { ...state, phase: { ...phase, runningSince: event.at, now: event.at } };
    case "tick":
    case "flip": {
      if (!running) return state;
      const used = usedMs(phase, event.at);
      if (used >= limitOf(state)) return timeout(state, event.at, event.wall);
      return event.type === "tick"
        ? { ...state, phase: { ...phase, now: event.at } }
        : {
            ...state,
            phase: { kind: "back", mode: "self", elapsedMs: used, since: event.at },
          };
    }
    default:
      return state;
  }
}

function onBack(
  state: DrillState,
  phase: Extract<DrillPhase, { kind: "back" }>,
  event: DrillEvent,
): DrillState {
  if (phase.mode === "timeout") return event.type === "next" ? advance(state) : state;
  if (event.type !== "grade") return state;
  if (event.key && event.at - phase.since < TUNING.keyLockAfterFlipMs) return state;
  const fast = event.result === "ok" && isFast(phase.elapsedMs, paceOf(state));
  const recorded = record(state, event.result, phase.elapsedMs, event.wall, phase.text);
  const feedback = {
    kind: "feedback",
    result: event.result,
    fast,
    elapsedMs: phase.elapsedMs,
  } as const;
  return {
    ...recorded,
    phase: phase.text === undefined ? feedback : { ...feedback, text: phase.text },
  };
}

function pause(state: DrillState, at: number): DrillState {
  const { phase } = state;
  if (phase.kind === "intro" || phase.kind === "finishing") return state;
  const frozen =
    phase.kind === "front"
      ? { ...phase, spentMs: usedMs(phase, at), runningSince: null, now: at }
      : phase;
  return { ...state, paused: true, phase: frozen };
}

function resume(state: DrillState, at: number): DrillState {
  const { phase } = state;
  const restarted =
    phase.kind === "front"
      ? { ...phase, runningSince: at, now: at }
      : phase.kind === "back"
        ? { ...phase, since: at }
        : phase;
  return { ...state, paused: false, phase: restarted };
}

export function drillReducer(state: DrillState, event: DrillEvent): DrillState {
  if (event.type === "pause" || event.type === "hide") return pause(state, event.at);
  if (state.paused) {
    if (event.type === "resume") return resume(state, event.at);
    return event.type === "advance" && state.phase.kind === "feedback"
      ? advance(state)
      : state;
  }
  const { phase } = state;
  switch (phase.kind) {
    case "intro":
      return event.type === "start" ? { ...state, phase: FRESH_FRONT } : state;
    case "front":
      return state.typed
        ? onTypedFront(state, phase, event)
        : onFront(state, phase, event);
    case "back":
      return onBack(state, phase, event);
    case "feedback":
      return event.type === "advance" ? advance(state) : state;
    case "finishing":
      return state;
  }
}
