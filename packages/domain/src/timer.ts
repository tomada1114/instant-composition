import { TUNING } from "./tuning";
import type { LimitSeconds } from "./types";

/**
 * Words in a model answer: whitespace-separated tokens carrying a letter or
 * digit, so a lone "—" or "&" is none. scripts/cards/text.mjs holds the same
 * rule for the card linter; tests/cards-word-count.test.ts keeps them equal.
 */
export function countWords(text: string): number {
  return text.split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

export function paceSecondsForWords(words: number): number {
  const { baseSeconds, secondsPerWord, minSeconds, maxSeconds } = TUNING.pace;
  const raw = Math.ceil(baseSeconds + words * secondsPerWord);
  return Math.min(maxSeconds, Math.max(minSeconds, raw));
}

export function paceMsForWords(words: number): number {
  return paceSecondsForWords(words) * 1000;
}

/** A card's pace; a deleted card, whose length is gone, takes the shortest. */
export function paceMsOf(words: number | null): number {
  return words === null ? TUNING.pace.minSeconds * 1000 : paceMsForWords(words);
}

/**
 * The limit a card of `round` runs against. A round dealt before the limit
 * became a setting recorded none: each of its cards ran against its pace.
 */
export function limitMsOf(
  round: { readonly limitMs?: number },
  paceMs: number,
): number {
  return round.limitMs ?? paceMs;
}

/** An answer as "fast" reads it. */
export interface Paced {
  readonly limitMs: number;
  /** Absent on an answer logged before the limit became a setting, whose limit was its pace. */
  readonly paceMs?: number;
}

export function paceOf(answer: Paced): number {
  return answer.paceMs ?? answer.limitMs;
}

/** Whether a flip came within the "fast" share of its card's pace, whatever the limit. */
export function isFast(elapsedMs: number, paceMs: number): boolean {
  return elapsedMs <= paceMs * TUNING.fastRatio;
}

/**
 * The start screen's "about M minutes" for `cards` cards, rounded up: each
 * card at the per-card limit the round will be dealt with, so the estimate
 * moves with the learner's choice rather than a figure of its own.
 */
export function estimateMinutes(cards: number, limitSeconds: LimitSeconds): number {
  return Math.ceil((cards * limitSeconds) / 60);
}
