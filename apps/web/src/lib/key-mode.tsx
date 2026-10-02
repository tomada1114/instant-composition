import { useEffect } from "react";

import { isTouchOnly } from "./touch";

const STORAGE_KEY = "instant-composition:keys";
const IGNORED = new Set([
  "Tab",
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  // An input method composing — a phone's software keyboard among them.
  "Process",
  "Unidentified",
]);

function turnOn(): void {
  document.documentElement.dataset["keys"] = "";
}

/**
 * Marks `<html data-keys>` once the learner presses a key, so key hints —
 * written `hidden keys:inline-flex` — appear only for someone who uses them.
 * Remembered across visits; storage that throws (a private window) only means
 * the hints wait for the next key press. A touch-only device never turns them
 * on: its software keyboard fires `keydown` too, and there the hints would
 * only cover the half-width buttons' labels.
 */
export function KeyMode(): null {
  useEffect(() => {
    if (isTouchOnly()) return;
    try {
      if (localStorage.getItem(STORAGE_KEY) !== null) turnOn();
    } catch {
      // Unreadable storage: the next key press turns the hints on.
    }
    function onKey(event: KeyboardEvent): void {
      if (IGNORED.has(event.key) || event.isComposing || event.metaKey || event.ctrlKey)
        return;
      turnOn();
      try {
        localStorage.setItem(STORAGE_KEY, "1");
      } catch {
        // Not remembered; this visit still shows them.
      }
      window.removeEventListener("keydown", onKey);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return null;
}
