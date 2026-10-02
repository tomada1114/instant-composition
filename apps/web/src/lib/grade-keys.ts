import type { Grade, GradeKeyTrio } from "../openapi";
import { TUNING } from "./tuning";

/**
 * The `KeyboardEvent.code` values a grade may take: ↑ ↓ ← →, 0–9 and A–Z,
 * which keeps Space, Enter, Esc and `?` the drill's own. The server refuses
 * the rest too; `tests/web-tuning.test.ts` holds this copy to the domain's.
 */
const GRADE_KEY = /^(?:Arrow(?:Up|Down|Left|Right)|Digit[0-9]|Key[A-Z])$/u;

const ARROWS: Readonly<Record<string, string>> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** The three self-grades, left to right as the trio shows them. */
export const GRADES: readonly Grade[] = ["again", "hard", "good"];

/** The key field of `GradeKeyTrio` that holds each grade's key. */
export const KEY_OF: Readonly<Record<Grade, keyof GradeKeyTrio>> = {
  again: "ng",
  hard: "hard",
  good: "ok",
};

/** Whether the drill may grade with `code`. */
export function isGradeKey(code: string): boolean {
  return GRADE_KEY.test(code);
}

/** Whether `keys` are the three nobody chose, which 1, 3, J/D and K/F grade beside. */
export function isDefaultGradeKeys(keys: GradeKeyTrio): boolean {
  return (
    keys.ok === TUNING.defaultGradeKeys.ok &&
    keys.ng === TUNING.defaultGradeKeys.ng &&
    keys.hard === TUNING.defaultHardKey
  );
}

/** A key as its hint shows it: the arrow itself, or the digit or letter it types. */
export function keyLabel(code: string): string {
  return ARROWS[code] ?? code.replace(/^(?:Key|Digit)/u, "");
}
