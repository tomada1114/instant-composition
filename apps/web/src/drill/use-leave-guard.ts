import { useBlocker } from "@tanstack/react-router";
import { useEffect, type Dispatch } from "react";

import type { DrillEvent, DrillState } from "./drill-state";

/** Every navigation asks while the guard is on; `disabled` is what turns it off. */
const ALWAYS = (): boolean => true;

function none(): void {
  // Nothing is waiting for an answer.
}

/** A navigation held until the learner says to leave or to stay. */
export interface LeaveGuard {
  readonly asking: boolean;
  readonly leave: () => void;
  readonly stay: () => void;
}

/**
 * From the round's first front until it closes, holds every navigation away —
 * a tab, a link, Back — pausing the drill, until `leave` lets it through or
 * `stay` drops it. A navigation made with `ignoreBlocker` ("stop" on the pause
 * sheet) is not held, and a reload or a closed tab is not asked about: the
 * round resumes after either. Should the round close while the question is
 * open, nothing is left to lose, so the navigation goes.
 */
export function useLeaveGuard(
  state: DrillState,
  dispatch: Dispatch<DrillEvent>,
): LeaveGuard {
  const active = state.phase.kind !== "intro" && state.phase.kind !== "finishing";
  const blocker = useBlocker({
    shouldBlockFn: ALWAYS,
    withResolver: true,
    enableBeforeUnload: false,
    disabled: !active,
  });

  const asking = blocker.status === "blocked";
  useEffect(() => {
    if (asking) dispatch({ type: "pause", at: performance.now() });
  }, [asking, dispatch]);
  useEffect(() => {
    if (!active && blocker.status === "blocked") blocker.proceed();
  }, [active, blocker]);

  return blocker.status === "blocked"
    ? { asking: true, leave: blocker.proceed, stay: blocker.reset }
    : { asking: false, leave: none, stay: none };
}
