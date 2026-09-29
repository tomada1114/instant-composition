import type { GradeKeys } from "../openapi";
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

/** Whether the drill may grade with `code`. */
export function isGradeKey(code: string): boolean {
  return GRADE_KEY.test(code);
}

/** Whether `keys` are the pair nobody chose, which K/F and J/D grade beside. */
export function isDefaultGradeKeys(keys: GradeKeys): boolean {
  return (
    keys.ok === TUNING.defaultGradeKeys.ok && keys.ng === TUNING.defaultGradeKeys.ng
  );
}

/** A key as its hint shows it: the arrow itself, or the digit or letter it types. */
export function keyLabel(code: string): string {
  return ARROWS[code] ?? code.replace(/^(?:Key|Digit)/u, "");
}
