import { TUNING } from "./tuning";

/** Words in an English answer, split on whitespace as `content/levels.json` counts them. */
export function countWords(en: string): number {
  return en.split(/\s+/u).filter((word) => word !== "").length;
}

export function limitSecondsForWords(words: number): number {
  const { baseSeconds, secondsPerWord, minSeconds, maxSeconds } = TUNING.timer;
  const raw = Math.ceil(baseSeconds + words * secondsPerWord);
  return Math.min(maxSeconds, Math.max(minSeconds, raw));
}

export function limitMsForWords(words: number): number {
  return limitSecondsForWords(words) * 1000;
}

/** Whether a flip came within the "fast" share of the limit. */
export function isFast(elapsedMs: number, limitMs: number): boolean {
  return elapsedMs <= limitMs * TUNING.fastRatio;
}

/** The start screen's "about M minutes" for `cards` cards, rounded up. */
export function estimateMinutes(cards: number): number {
  return Math.ceil((cards * TUNING.estimateSecondsPerCard) / 60);
}
