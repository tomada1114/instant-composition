import { isDefaultGradeKeys } from "../lib/grade-keys";
import type { GradeKeys } from "../openapi";
import type { DrillState } from "./drill-state";

/** What a key or a control asks of the drill; the caller stamps it with the time. */
export type DrillKeyAction =
  | { readonly type: "start" | "flip" | "next" | "pause" | "resume" }
  | { readonly type: "grade"; readonly result: "ok" | "ng" }
  | { readonly type: "scroll"; readonly direction: 1 | -1 };

/** The two things `keyAction` reads off a `KeyboardEvent`. */
export type KeyPress = Pick<KeyboardEvent, "key" | "code">;

// Read by the character typed, as before the keys could be chosen: → and ←
// with the home-row letters beside them.
const DEFAULT_OK = new Set(["ArrowRight", "k", "K", "f", "F"]);
const DEFAULT_NG = new Set(["ArrowLeft", "j", "J", "d", "D"]);
const PRIMARY_KEYS = new Set([" ", "Enter"]);
const SCROLL: Readonly<Record<string, 1 | -1>> = { ArrowDown: 1, ArrowUp: -1 };

/**
 * The grade `press` gives. The default pair also takes K/F and J/D; a pair
 * the learner chose is matched by `code` alone, so it holds whatever the
 * layout or input method types.
 */
function gradeOf(press: KeyPress, keys: GradeKeys): "ok" | "ng" | undefined {
  if (isDefaultGradeKeys(keys)) {
    if (DEFAULT_OK.has(press.key)) return "ok";
    return DEFAULT_NG.has(press.key) ? "ng" : undefined;
  }
  if (press.code === keys.ok) return "ok";
  return press.code === keys.ng ? "ng" : undefined;
}

/**
 * Maps a key press to the drill's action in its current state, with `keys`
 * the learner's grade keys. While paused only Escape is taken, so Space and
 * Enter reach the dialog's focused button as a native press. `?` pauses too:
 * the pause dialog is where the keys are listed. A grade key never scrolls,
 * so ↑ or ↓ chosen as one leaves the card to the other arrow.
 */
export function keyAction(
  state: DrillState,
  press: KeyPress,
  keys: GradeKeys,
): DrillKeyAction | undefined {
  const { phase } = state;
  const { key } = press;
  if (state.paused) return key === "Escape" ? { type: "resume" } : undefined;
  if (phase.kind === "finishing") return undefined;
  if (phase.kind === "intro")
    return PRIMARY_KEYS.has(key) ? { type: "start" } : undefined;
  if (key === "Escape" || key === "?") return { type: "pause" };
  if (phase.kind === "front")
    return PRIMARY_KEYS.has(key) ? { type: "flip" } : undefined;
  if (phase.kind !== "back") return undefined;

  const grade = gradeOf(press, keys);
  if (phase.mode === "timeout" && (PRIMARY_KEYS.has(key) || grade === "ok")) {
    return { type: "next" };
  }
  if (grade !== undefined) {
    return phase.mode === "timeout" ? undefined : { type: "grade", result: grade };
  }
  const direction = SCROLL[key];
  return direction === undefined ? undefined : { type: "scroll", direction };
}
