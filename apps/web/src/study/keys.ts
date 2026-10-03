import { isDefaultGradeKeys } from "../lib/grade-keys";
import type { Grade, GradeKeyTrio } from "../openapi";
import type { StudyState } from "./study-state";

/** What a key or a control asks of the drill; the caller stamps it with the time. */
export type StudyKeyAction =
  | { readonly type: "start" | "flip" | "pause" | "resume" }
  | { readonly type: "grade"; readonly grade: Grade }
  | { readonly type: "scroll"; readonly direction: 1 | -1 };

/** The two things `keyAction` reads off a `KeyboardEvent`. */
export type KeyPress = Pick<KeyboardEvent, "key" | "code">;

// While the default is kept: × on ← and 1, △ on 2, ○ on → and 3, read by the
// key or by the character typed, with the home-row letters J/D and K/F beside
// × and ○ as before the keys could be chosen.
const DEFAULTS: readonly (readonly [Grade, ReadonlySet<string>])[] = [
  ["again", new Set(["ArrowLeft", "Digit1", "1", "j", "J", "d", "D"])],
  ["hard", new Set(["Digit2", "2"])],
  ["good", new Set(["ArrowRight", "Digit3", "3", "k", "K", "f", "F"])],
];
const PRIMARY_KEYS = new Set([" ", "Enter"]);
const SCROLL: Readonly<Record<string, 1 | -1>> = { ArrowDown: 1, ArrowUp: -1 };

/**
 * The grade `press` gives. The default trio also takes 1, 3, J/D and K/F; a
 * trio the learner chose is matched by `code` alone, so it holds whatever the
 * layout or input method types.
 */
function gradeOf(press: KeyPress, keys: GradeKeyTrio): Grade | undefined {
  if (isDefaultGradeKeys(keys)) {
    return DEFAULTS.find(([, set]) => set.has(press.code) || set.has(press.key))?.[0];
  }
  if (press.code === keys.ng) return "again";
  if (press.code === keys.hard) return "hard";
  return press.code === keys.ok ? "good" : undefined;
}

/**
 * Maps a key press to the drill's action in its current state, with `keys`
 * the learner's grade keys. While paused only Escape is taken, so Space and
 * Enter reach the dialog's focused button as a native press. `?` pauses too:
 * the pause dialog is where the keys are listed. Space and Enter do nothing on
 * a back, timed out or not: a grade cannot be skipped. A grade key never
 * scrolls, so ↑ or ↓ chosen as one leaves the card to the other arrow.
 */
export function keyAction(
  state: StudyState,
  press: KeyPress,
  keys: GradeKeyTrio,
): StudyKeyAction | undefined {
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
  if (grade !== undefined) return { type: "grade", grade };
  const direction = SCROLL[key];
  return direction === undefined ? undefined : { type: "scroll", direction };
}
