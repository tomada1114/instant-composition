// FSRS-6's long-term schedule, as ts-fsrs 5.4.2's LongTermScheduler computes
// it (src/impl/long_term_scheduler.ts and src/strategies/seed.ts), whose
// notice follows: the formulas are in fsrs-memory.ts and the intervals in
// fsrs-interval.ts. Elapsed days are the difference of two practice days,
// never of wall-clock time.
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
import { addDays, dayDiff } from "./day";
import { intervalsFor } from "./fsrs-interval";
import { forgettingCurve, initialMemory, nextMemory, type Memory } from "./fsrs-memory";
import type { DayKey } from "./types";

/** The three self-grades: forgot, unsure and remembered. There is no easy. */
export type FsrsGrade = "again" | "hard" | "good";

/** A card's FSRS schedule after at least one answer; a new card has none. */
export interface FsrsState {
  readonly stability: number;
  readonly difficulty: number;
  /** Answers that moved the schedule, one per practice day at most. */
  readonly reps: number;
  /** Reviews graded again; a new card's first again is not one. */
  readonly lapses: number;
  readonly lastDay: DayKey;
  readonly dueDay: DayKey;
}

/** Where one grade leaves a card. */
export interface Scheduled {
  readonly state: FsrsState;
  /** Days from the answer to `state.dueDay`, at least 1. */
  readonly intervalDays: number;
}

/** Each grade's outcome for a card answered today: what its buttons show. */
export type GradePreview = Readonly<Record<FsrsGrade, Scheduled>>;

const RATING = { again: 1, hard: 2, good: 3 } as const satisfies Record<
  FsrsGrade,
  number
>;

function elapsedSince(lastDay: DayKey, today: DayKey): number {
  // A day before the last answer reads as the same day rather than a
  // negative wait, which FSRS has no meaning for.
  return Math.max(0, dayDiff(lastDay, today));
}

/**
 * Each grade's next state and interval for a card answered on `today`.
 *
 * @param previous - The card's state, or undefined for a card never answered
 * under FSRS.
 * @param cardId - Seeds the fuzz with `reps`, so cards graded alike on one day
 * spread over the days around their interval, and a repeat gives the same day.
 */
export function previewGrades(
  previous: FsrsState | undefined,
  today: DayKey,
  cardId: string,
): GradePreview {
  const reps = (previous?.reps ?? 0) + 1;
  const elapsedDays =
    previous === undefined ? 0 : elapsedSince(previous.lastDay, today);
  const memory = (grade: FsrsGrade): Memory =>
    previous === undefined
      ? initialMemory(RATING[grade])
      : nextMemory(previous, elapsedDays, RATING[grade]);
  const memories = {
    again: memory("again"),
    hard: memory("hard"),
    good: memory("good"),
  };
  const intervals = intervalsFor(
    {
      again: memories.again.stability,
      hard: memories.hard.stability,
      good: memories.good.stability,
    },
    elapsedDays,
    `${cardId}${String(reps)}`,
  );
  const lapses = previous?.lapses ?? 0;
  const scheduled = (grade: FsrsGrade): Scheduled => ({
    state: {
      ...memories[grade],
      reps,
      lapses: grade === "again" && previous !== undefined ? lapses + 1 : lapses,
      lastDay: today,
      dueDay: addDays(today, intervals[grade]),
    },
    intervalDays: intervals[grade],
  });
  return {
    again: scheduled("again"),
    hard: scheduled("hard"),
    good: scheduled("good"),
  };
}

/** The state one grade on `today` leaves a card in; see {@link previewGrades}. */
export function scheduleCard(
  previous: FsrsState | undefined,
  grade: FsrsGrade,
  today: DayKey,
  cardId: string,
): Scheduled {
  return previewGrades(previous, today, cardId)[grade];
}

/**
 * The chance the learner still recalls the card on `today`:
 * `R(t, S) = (1 + F·t/S)^(−w20)`, with `F = 0.9^(−1/w20) − 1` and `t` the days
 * since its last answer. 0.9 when `t` equals the stability.
 */
export function retrievability(
  state: Pick<FsrsState, "stability" | "lastDay">,
  today: DayKey,
): number {
  return forgettingCurve(elapsedSince(state.lastDay, today), state.stability);
}
