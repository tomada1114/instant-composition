import type { DrillState } from "../../core/drill-state";

/** What a key asks of the drill; the caller stamps it with the time. */
export type DrillKeyAction =
  | { readonly type: "start" | "flip" | "next" | "pause" | "resume" }
  | { readonly type: "grade"; readonly result: "ok" | "ng" }
  | { readonly type: "scroll"; readonly direction: 1 | -1 };

const OK_KEYS = new Set(["ArrowRight", "j", "J"]);
const NG_KEYS = new Set(["ArrowLeft", "f", "F"]);
const PRIMARY_KEYS = new Set([" ", "Enter"]);
const SCROLL: Readonly<Record<string, 1 | -1>> = { ArrowDown: 1, ArrowUp: -1 };

/**
 * Maps a `KeyboardEvent.key` to the drill's action in its current state.
 * While paused only Escape is taken, so Space and Enter reach the sheet's
 * focused button as a native press.
 */
export function keyAction(state: DrillState, key: string): DrillKeyAction | undefined {
  const { phase } = state;
  if (state.paused) return key === "Escape" ? { type: "resume" } : undefined;
  if (phase.kind === "finishing") return undefined;
  if (phase.kind === "intro")
    return PRIMARY_KEYS.has(key) ? { type: "start" } : undefined;
  if (key === "Escape") return { type: "pause" };
  if (phase.kind === "front")
    return PRIMARY_KEYS.has(key) ? { type: "flip" } : undefined;
  if (phase.kind !== "back") return undefined;

  const direction = SCROLL[key];
  if (direction !== undefined) return { type: "scroll", direction };
  if (phase.mode === "timeout") {
    return PRIMARY_KEYS.has(key) || OK_KEYS.has(key) ? { type: "next" } : undefined;
  }
  if (OK_KEYS.has(key)) return { type: "grade", result: "ok" };
  if (NG_KEYS.has(key)) return { type: "grade", result: "ng" };
  return undefined;
}
