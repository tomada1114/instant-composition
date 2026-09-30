import { TUNING } from "./tuning";
import type { AnswerMode, LimitSeconds } from "./types";

/**
 * Words in a model answer: whitespace-separated tokens carrying a letter or
 * digit, so a lone "—" or "&" is none. scripts/cards/text.mjs holds the same
 * rule for the card linter; tests/cards-word-count.test.ts keeps them equal.
 */
export function countWords(text: string): number {
  return text.split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/** The most an answer's `elapsedMs` holds: all a typed answer is clamped to. */
const MAX_ELAPSED_MS = 600_000;

const PACES = {
  spoken: TUNING.pace,
  typed: TUNING.typedPace,
} as const satisfies Record<AnswerMode, unknown>;

/**
 * Settings, a round or an answer's mode. One written before the mode existed
 * has none, and every answer then was spoken.
 */
export function answerModeOf(
  record: { readonly answerMode?: AnswerMode } | undefined,
): AnswerMode {
  return record?.answerMode ?? "spoken";
}

export function paceSecondsForWords(words: number, mode: AnswerMode): number {
  const { baseSeconds, secondsPerWord, minSeconds, maxSeconds } = PACES[mode];
  const raw = Math.ceil(baseSeconds + words * secondsPerWord);
  return Math.min(maxSeconds, Math.max(minSeconds, raw));
}

export function paceMsForWords(words: number, mode: AnswerMode): number {
  return paceSecondsForWords(words, mode) * 1000;
}

/** A card's pace in `mode`; a deleted card, whose length is gone, takes the shortest. */
export function paceMsOf(words: number | null, mode: AnswerMode): number {
  return words === null ? PACES[mode].minSeconds * 1000 : paceMsForWords(words, mode);
}

/**
 * The limit a card of `round` runs against. A typed round has none, so its
 * answers are held only to the cap. A spoken round dealt before the limit
 * became a setting recorded none: each of its cards ran against its pace.
 */
export function limitMsOf(
  round: { readonly limitMs?: number; readonly answerMode?: AnswerMode },
  paceMs: number,
): number {
  return answerModeOf(round) === "typed" ? MAX_ELAPSED_MS : (round.limitMs ?? paceMs);
}

/** An answer as "fast" reads it. */
export interface Paced {
  readonly limitMs: number;
  /** Absent on an answer logged before the limit became a setting, whose limit was its pace. */
  readonly paceMs?: number;
}

/** The pace an answer is judged by: its round's mode's, recorded with it. */
export function paceOf(answer: Paced): number {
  return answer.paceMs ?? answer.limitMs;
}

/**
 * Whether a flip came within the "fast" share of `paceMs`, whatever the limit.
 * The pace is the one of the answer's round's mode, so one rule serves both.
 */
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
