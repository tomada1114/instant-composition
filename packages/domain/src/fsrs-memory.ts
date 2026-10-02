// FSRS-6's memory formulas, adapted from ts-fsrs 5.4.2 (src/algorithm.ts and
// src/help.ts), whose notice follows. The operations and their roundings are
// kept in ts-fsrs's order, so the golden vectors in tests/fixtures/ match to
// the last bit rather than within a tolerance.
//
// MIT License
//
// Copyright (c) 2026 Open Spaced Repetition
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
import { TUNING } from "./tuning";

/** A grade as FSRS numbers it: again 1, hard 2, good 3, and easy 4, which no card is given. */
export type Rating = 1 | 2 | 3 | 4;

/** What FSRS remembers of a card between reviews. */
export interface Memory {
  readonly stability: number;
  readonly difficulty: number;
}

const W = TUNING.fsrs.weights;
const S_MIN = 0.001;
const S_MAX = 36_500;
const EASY: Rating = 4;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const DECAY = -W[20];
const FACTOR = roundTo(Math.exp(Math.pow(DECAY, -1) * Math.log(0.9)) - 1, 8);

/** Days of stability to days of interval: 1 at a desired retention of 0.9. */
export const INTERVAL_MODIFIER = roundTo(
  (Math.pow(TUNING.fsrs.desiredRetention, 1 / DECAY) - 1) / FACTOR,
  8,
);

/** `R(t, S) = (1 + F·t/S)^(−w20)`: the chance of recall `elapsedDays` after a review. */
export function forgettingCurve(elapsedDays: number, stability: number): number {
  return roundTo(Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY), 8);
}

function initDifficulty(rating: Rating): number {
  return roundTo(W[4] - Math.exp((rating - 1) * W[5]) + 1, 8);
}

/** S0 = w[G−1], floored at 0.1; D0 = w4 − e^(w5·(G−1)) + 1, clamped to 1..10. */
export function initialMemory(rating: Exclude<Rating, 4>): Memory {
  const initial = { 1: W[0], 2: W[1], 3: W[2] } as const;
  return {
    stability: Math.max(initial[rating], 0.1),
    difficulty: clamp(initDifficulty(rating), 1, 10),
  };
}

/** The grade's step on D, damped toward 10, then reverted toward easy's D0 by w7. */
function nextDifficulty(difficulty: number, rating: Rating): number {
  const delta = -W[6] * (rating - 3);
  const damped = difficulty + roundTo((delta * (10 - difficulty)) / 9, 8);
  return clamp(roundTo(W[7] * initDifficulty(EASY) + (1 - W[7]) * damped, 8), 1, 10);
}

function recallStability(memory: Memory, recall: number, rating: Rating): number {
  const { stability: s, difficulty: d } = memory;
  const hardPenalty = rating === 2 ? W[15] : 1;
  return roundTo(
    clamp(
      s *
        (1 +
          Math.exp(W[8]) *
            (11 - d) *
            Math.pow(s, -W[9]) *
            (Math.exp((1 - recall) * W[10]) - 1) *
            hardPenalty),
      S_MIN,
      S_MAX,
    ),
    8,
  );
}

function forgetStability(memory: Memory, recall: number): number {
  const { stability: s, difficulty: d } = memory;
  return roundTo(
    clamp(
      W[11] *
        Math.pow(d, -W[12]) *
        (Math.pow(s + 1, W[13]) - 1) *
        Math.exp((1 - recall) * W[14]),
      S_MIN,
      S_MAX,
    ),
    8,
  );
}

/**
 * The memory after a review `elapsedDays` after the last one. Long-term only:
 * a lapse never ends above the stability it started from.
 */
export function nextMemory(
  memory: Memory,
  elapsedDays: number,
  rating: Exclude<Rating, 4>,
): Memory {
  const recall = forgettingCurve(elapsedDays, memory.stability);
  const stability =
    rating === 1
      ? clamp(roundTo(memory.stability, 8), S_MIN, forgetStability(memory, recall))
      : recallStability(memory, recall, rating);
  return { stability, difficulty: nextDifficulty(memory.difficulty, rating) };
}
