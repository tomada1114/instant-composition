import { studyReducer } from "../study/study-machine";
import { usedMs } from "../study/study-state";
import {
  limitOf,
  fastThresholdOf,
  type DrillEvent,
  type DrillState,
} from "./drill-state";

/** Adds the drill's timeout and fast/combo feedback to the shared study reducer. */
export function drillReducer(state: DrillState, event: DrillEvent): DrillState {
  if (event.type === "remove") return state;
  const { phase } = state;
  if (
    !state.paused &&
    phase.kind === "front" &&
    phase.runningSince !== null &&
    (event.type === "tick" || event.type === "flip") &&
    usedMs(phase, event.at) >= limitOf(state)
  ) {
    return {
      ...state,
      phase: {
        kind: "back",
        mode: "timeout",
        elapsedMs: limitOf(state),
        since: event.at,
      },
    };
  }
  const next = studyReducer(state, event);
  if (next === state) return state;
  if (
    next.answers.length === state.answers.length ||
    event.type !== "grade" ||
    phase.kind !== "back"
  )
    return { ...state, ...next };
  const fast =
    phase.mode === "self" &&
    event.grade !== "again" &&
    phase.elapsedMs <= fastThresholdOf(state);
  return {
    ...state,
    ...next,
    combo: event.grade === "again" ? 0 : state.combo + 1,
    phase: next.phase.kind === "feedback" ? { ...next.phase, fast } : next.phase,
  };
}
