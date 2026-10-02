import { TUNING } from "./tuning";
import type { GradeKeys, Settings } from "./types";

/**
 * The `KeyboardEvent.code` values a grade may take: ↑ ↓ ← →, 0–9 and A–Z.
 * Space, Enter, Esc and `?` (`Slash`) fall outside it, which keeps the drill's
 * own keys out of reach. The contract's `gradeKeySchema` states the same set.
 */
const GRADE_KEY = /^(?:Arrow(?:Up|Down|Left|Right)|Digit[0-9]|Key[A-Z])$/u;

/** Whether the drill may grade with `code`. */
export function isGradeKey(code: string): boolean {
  return GRADE_KEY.test(code);
}

/**
 * Keys the drill may grade with, a different one for each grade: ○ and ×,
 * and △ when it is given.
 */
export function isGradeKeyPair(keys: GradeKeys): boolean {
  const codes = [keys.ok, keys.ng, ...(keys.hard === undefined ? [] : [keys.hard])];
  return codes.every(isGradeKey) && new Set(codes).size === codes.length;
}

/**
 * The three grade keys the learner chose, or the default for those never
 * chosen. A pair stored before three grades gives △ the first of
 * `TUNING.hardKeys` its two keys leave free.
 */
export function gradeKeysOf(settings: Settings | undefined): Required<GradeKeys> {
  const keys: GradeKeys = settings?.gradeKeys ?? TUNING.defaultGradeKeys;
  const { ok, ng, hard } = keys;
  const free = TUNING.hardKeys.find((code) => code !== ok && code !== ng);
  return { ok, ng, hard: hard ?? free ?? TUNING.hardKeys[0] };
}
