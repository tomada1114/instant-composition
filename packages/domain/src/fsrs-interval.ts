// FSRS-6's intervals and their fuzz, adapted from ts-fsrs 5.4.2
// (src/algorithm.ts, src/help.ts, src/alea.ts and
// src/impl/long_term_scheduler.ts). Its Alea generator is a port of an
// algorithm by Johannes Baagøe, by way of David Bau's seedrandom; both
// notices follow, for the one MIT license they share.
//
// Copyright (c) 2026 Open Spaced Repetition
// Copyright (C) 2010 by Johannes Baagøe <baagoe@baagoe.org>
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
import { INTERVAL_MODIFIER } from "./fsrs-memory";
import { TUNING } from "./tuning";

const MAX_DAYS = TUNING.fsrs.maximumIntervalDays;
const TWO_POW_MINUS_32 = 2.3283064365386963e-10;

/** Alea's string hash, `Mash`, one instance per generator as Alea makes them. */
function mash(): (data: string) => number {
  let n = 0xefc8249d;
  return (data) => {
    for (let index = 0; index < data.length; index += 1) {
      n += data.charCodeAt(index);
      let h = 0.02519603282416938 * n;
      n = h >>> 0;
      h -= n;
      h *= n;
      n = h >>> 0;
      h -= n;
      n += h * 0x100000000;
    }
    return (n >>> 0) * TWO_POW_MINUS_32;
  };
}

/** The first number in `[0, 1)` an Alea generator seeded with `seed` gives. */
function aleaFirst(seed: string): number {
  const hash = mash();
  const space = hash(" ");
  // Alea's other two state words: the first number never reads them, but the
  // hash state they leave behind is what the seed is then hashed from.
  hash(" ");
  hash(" ");
  const first = space - hash(seed);
  const s0 = first < 0 ? first + 1 : first;
  // One step of Alea's `next()`, its carry `c` still at 1.
  const t = 2091639 * s0 + TWO_POW_MINUS_32;
  return t - Math.trunc(t);
}

const FUZZ_RANGES = [
  { start: 2.5, end: 7, factor: 0.15 },
  { start: 7, end: 20, factor: 0.1 },
  { start: 20, end: Number.POSITIVE_INFINITY, factor: 0.05 },
] as const;

/**
 * An interval moved within `[max(2, round(I − δ)), min(round(I + δ), max)]`,
 * never to a day the card has already waited past. Under 2.5 days it stays.
 */
function fuzzed(interval: number, elapsedDays: number, seed: string): number {
  if (interval < 2.5) {
    return interval;
  }
  let delta = 1;
  for (const range of FUZZ_RANGES) {
    delta += range.factor * Math.max(Math.min(interval, range.end) - range.start, 0);
  }
  const capped = Math.min(interval, MAX_DAYS);
  let min = Math.max(2, Math.round(capped - delta));
  const max = Math.min(Math.round(capped + delta), MAX_DAYS);
  if (capped > elapsedDays) {
    min = Math.max(min, elapsedDays + 1);
  }
  min = Math.min(min, max);
  return Math.floor(aleaFirst(seed) * (max - min + 1) + min);
}

function intervalFor(stability: number, elapsedDays: number, seed: string): number {
  const days = Math.min(
    Math.max(1, Math.round(stability * INTERVAL_MODIFIER)),
    MAX_DAYS,
  );
  return fuzzed(days, elapsedDays, seed);
}

/** Days until the next review per grade, again < hard < good as ts-fsrs orders them. */
export interface Intervals {
  readonly again: number;
  readonly hard: number;
  readonly good: number;
}

/**
 * Each grade's interval from the stability it leads to. Every grade's fuzz
 * draws the same first number from a generator seeded with `seed`, ts-fsrs's
 * card id and `reps` after this review, so cards graded alike on one day
 * spread out while the same inputs always give the same day.
 */
export function intervalsFor(
  stability: { readonly again: number; readonly hard: number; readonly good: number },
  elapsedDays: number,
  seed: string,
): Intervals {
  const again = Math.min(
    intervalFor(stability.again, elapsedDays, seed),
    intervalFor(stability.hard, elapsedDays, seed),
  );
  const hard = Math.max(intervalFor(stability.hard, elapsedDays, seed), again + 1);
  const good = Math.max(intervalFor(stability.good, elapsedDays, seed), hard + 1);
  return { again, hard, good };
}
