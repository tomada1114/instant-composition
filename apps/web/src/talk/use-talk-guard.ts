import { useBlocker } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/** Every navigation asks while the guard is on; `disabled` is what turns it off. */
const ALWAYS = (): boolean => true;

const INTERACTIVE = "a, button, input, select, textarea, summary, [role='button']";

/** W4, asked from ✕ or Esc (`close`) or from a tab, a link or Back (`navigation`). */
export interface TalkLeave {
  readonly asking: "close" | "navigation" | undefined;
  readonly ask: () => void;
  /** Leaves: the held navigation goes, or the question from ✕ is closed. */
  readonly leave: () => void;
  readonly stay: () => void;
}

/**
 * From a talk's first line until it ends, holds every navigation away — a
 * tab, a link, Back — until W4's 「終える」 lets it through or 「続ける」 drops it,
 * the drill's `useLeaveGuard` pattern. A reload or a closed tab is never asked
 * about: that talk is simply not kept.
 */
export function useTalkLeave(active: boolean): TalkLeave {
  const [closing, setClosing] = useState(false);
  // A talk that ends under a ✕-opened W4 must not bring W4 back with the next
  // talk, so the question is dropped, during render, as the talk stops.
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setClosing(false);
  }
  const blocker = useBlocker({
    shouldBlockFn: ALWAYS,
    withResolver: true,
    enableBeforeUnload: false,
    disabled: !active,
  });
  const held = blocker.status === "blocked";

  useEffect(() => {
    if (!active && blocker.status === "blocked") blocker.proceed();
  }, [active, blocker]);

  return {
    asking: held ? "navigation" : closing && active ? "close" : undefined,
    ask() {
      setClosing(true);
    },
    leave() {
      setClosing(false);
      if (blocker.status === "blocked") blocker.proceed();
    },
    stay() {
      setClosing(false);
      if (blocker.status === "blocked") blocker.reset();
    },
  };
}

/**
 * The talk screen's keys: Enter presses the screen's one primary action
 * (`data-primary`) unless focus is on a control, which takes its own Enter —
 * a field sends by itself — and while a dialog is up (`enter` off). Esc is
 * `onEscape`.
 */
export function useTalkKeys(onEscape: () => void, enter: boolean): void {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      // Esc and Enter mid-conversion belong to the input method.
      if (event.isComposing || event.key === "Process") return;
      if (event.key === "Escape") {
        onEscape();
        return;
      }
      if (!enter || event.key !== "Enter" || event.repeat) return;
      if (
        event.target instanceof Element &&
        event.target.closest(INTERACTIVE) !== null
      ) {
        return;
      }
      const primary = document.querySelector<HTMLButtonElement>("button[data-primary]");
      if (primary === null || primary.disabled) return;
      event.preventDefault();
      primary.click();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onEscape, enter]);
}
