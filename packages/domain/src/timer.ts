import { TUNING } from "./tuning";

/**
 * Words in a model answer: whitespace-separated tokens carrying a letter or
 * digit, so a lone "—" or "&" is none. scripts/cards/text.mjs holds the same
 * rule for the card linter; tests/cards-word-count.test.ts keeps them equal.
 */
export function countWords(text: string): number {
  return text.split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
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
