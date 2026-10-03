import type { SoundName } from "../study/sound";

/**
 * The sound a grade plays the moment it is given: the ○ sound on △ and ○, a
 * step up when fast, the combo's in its place from 2 in a row; none on ×.
 */
export function gradeSound(feedback: {
  readonly grade: "again" | "hard" | "good";
  readonly fast: boolean;
  readonly combo: number;
}): SoundName | undefined {
  if (feedback.grade === "again") return undefined;
  if (feedback.combo >= 2) return "combo";
  return feedback.fast ? "okFast" : "ok";
}

/**
 * The one sound a finished round plays: `fanfare` when the streak grew or a
 * milestone was reached, in place of `closing`, never on top of it.
 */
export function roundSound(summary: {
  readonly streak: { readonly changed: boolean };
  readonly titles: readonly string[];
}): "closing" | "fanfare" {
  return summary.streak.changed || summary.titles.length > 0 ? "fanfare" : "closing";
}
