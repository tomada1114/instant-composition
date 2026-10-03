import { TUNING } from "../lib/tuning";
import type { Grade } from "../openapi";
import {
  answerId,
  currentCard,
  FRESH_FRONT,
  usedMs,
  type StudyEvent,
  type StudyPhase,
  type StudyState,
} from "./study-state";
import { afterGrade, nextCard } from "./re-asks";

/**
 * One round's progress in the browser, as a pure reducer: every event carries
 * the time it happened at, so the clock is an input, never read here.
 */

/** Moves to the next card — a re-ask that fell due, or the next first pass — or finishes. */
function advance(state: StudyState): StudyState {
  const next = nextCard(state);
  return next === undefined
    ? { ...state, phase: { kind: "finishing" } }
    : { ...next, phase: FRESH_FRONT };
}

function record(
  state: StudyState,
  grade: Grade,
  back: Extract<StudyPhase, { kind: "back" }>,
  wall: number,
): StudyState {
  const card = currentCard(state);
  if (card === undefined) return state;
  return {
    ...state,
    ...afterGrade(state, grade),
    answers: [
      ...state.answers,
      {
        id: answerId(state.sessionId, card.cardId, card.ask),
        roundId: state.sessionId,
        cardId: card.cardId,
        pass: card.pass,
        grade,
        timedOut: back.mode === "timeout",
        elapsedMs: Math.round(back.elapsedMs),
        answeredAt: wall,
      },
    ],
  };
}

function onFront(
  state: StudyState,
  phase: Extract<StudyPhase, { kind: "front" }>,
  event: StudyEvent,
): StudyState {
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
  state: StudyState,
  phase: Extract<StudyPhase, { kind: "back" }>,
  event: StudyEvent,
): StudyState {
  if (event.type !== "grade") return state;
  if (event.key && event.at - phase.since < TUNING.keyLockAfterFlipMs) return state;
  return {
    ...record(state, event.grade, phase, event.wall),
    phase: {
      kind: "feedback",
      mode: phase.mode,
      grade: event.grade,
      fast: false,
      elapsedMs: phase.elapsedMs,
    },
  };
}

function pause(state: StudyState, at: number): StudyState {
  const { phase } = state;
  if (phase.kind === "intro" || phase.kind === "finishing") return state;
  const frozen =
    phase.kind === "front"
      ? { ...phase, spentMs: usedMs(phase, at), runningSince: null, now: at }
      : phase;
  return { ...state, paused: true, phase: frozen };
}

function resume(state: StudyState, at: number): StudyState {
  const { phase } = state;
  const restarted =
    phase.kind === "front"
      ? { ...phase, runningSince: at, now: at }
      : phase.kind === "back"
        ? { ...phase, since: at }
        : phase;
  return { ...state, paused: false, phase: restarted };
}

export function studyReducer(state: StudyState, event: StudyEvent): StudyState {
  if (event.type === "remove") {
    if (state.phase.kind !== "back" || state.card?.cardId !== event.cardId)
      return state;
    return advance({
      ...state,
      paused: false,
      fresh: state.fresh.filter((id) => id !== event.cardId),
      reAsks: state.reAsks.filter((card) => card.cardId !== event.cardId),
    });
  }
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
      return onFront(state, phase, event);
    case "back":
      return onBack(state, phase, event);
    case "feedback":
      return event.type === "advance" ? advance(state) : state;
    case "finishing":
      return state;
  }
}
