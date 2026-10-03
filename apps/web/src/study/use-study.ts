import { useEffect, useRef, type Dispatch } from "react";
import { TUNING } from "../lib/tuning";
import type { Grade, GradeKeyTrio } from "../openapi";
import { currentCard, type StudyEvent, type StudyState } from "./study-state";
import { keyAction, type StudyKeyAction } from "./keys";

/** What the page asks of study: a key's action, or the page going hidden. */
export type StudyAction = StudyKeyAction | { readonly type: "hide" };

/** How long a grade's feedback holds before the next front; never over 320 ms. */
export function feedbackMs(feedback: {
  readonly grade: Grade;
  readonly fast: boolean;
}): number {
  if (feedback.grade === "again") return 160;
  return feedback.fast ? TUNING.feedbackMaxMs : 240;
}

/**
 * Feeds the reducer its clock: `shown` on the frame the front is drawn, a
 * and `advance` once a grade's feedback is over. Drill adds its own timed ticks.
 */
export function useStudyClock(state: StudyState, dispatch: Dispatch<StudyEvent>): void {
  const { phase, paused } = state;
  const card = currentCard(state);
  const cardKey = card === undefined ? "" : `${String(card.ask)}:${card.cardId}`;
  const waiting = phase.kind === "front" && phase.runningSince === null && !paused;
  const hold = phase.kind === "feedback" ? feedbackMs(phase) : undefined;

  useEffect(() => {
    if (!waiting) return undefined;
    const frame = requestAnimationFrame(() => {
      dispatch({ type: "shown", at: performance.now() });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [waiting, cardKey, dispatch]);

  useEffect(() => {
    if (hold === undefined) return undefined;
    const timer = setTimeout(() => {
      dispatch({ type: "advance", at: performance.now() });
    }, hold);
    return () => {
      clearTimeout(timer);
    };
  }, [hold, cardKey, dispatch]);
}

/** A key typed into a field is text, not the drill's; only Escape still pauses from one. */
function inField(event: KeyboardEvent): boolean {
  return (
    event.key !== "Escape" &&
    event.target instanceof Element &&
    event.target.closest("input, textarea") !== null
  );
}

/**
 * Routes the drill's keys to `onAction`, grading with `gradeKeys`, and pauses
 * when the page is hidden. A page shown again stays paused: the dialog waits
 * for "continue".
 */
export function useStudyKeys(
  state: StudyState,
  gradeKeys: GradeKeyTrio,
  onAction: (action: StudyAction) => void,
): void {
  const latest = useRef({ state, gradeKeys, onAction });
  useEffect(() => {
    latest.current = { state, gradeKeys, onAction };
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.repeat || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey || inField(event)) return;
      const action = keyAction(latest.current.state, event, latest.current.gradeKeys);
      if (action === undefined) return;
      event.preventDefault();
      latest.current.onAction(action);
    }
    function onVisibility(): void {
      if (document.visibilityState === "hidden")
        latest.current.onAction({ type: "hide" });
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
