import { previewGrades, type FsrsGrade, type FsrsState } from "./fsrs";
import type { CompositionDetail, ItemProgress } from "./records";
import type { AnswerResult, DayKey, Pass } from "./types";

/** An answer's grade as a client sends it: a grade, or an older client's result. */
export interface GradeInput {
  readonly result?: AnswerResult;
  readonly grade?: FsrsGrade;
  readonly timedOut?: boolean;
}

/** A drill answer's grade, and whether the timer ran out before it. */
export interface Graded {
  readonly grade: FsrsGrade;
  readonly timedOut: boolean;
}

const FROM_RESULT: Readonly<Record<AnswerResult, Graded>> = {
  ok: { grade: "good", timedOut: false },
  ng: { grade: "again", timedOut: false },
  timeout: { grade: "again", timedOut: true },
};

/**
 * The grade an answer carries: its own, or for an answer an older client
 * queued with only a result, `ok` as good, `ng` as again and `timeout` as
 * again timed out. Undefined when it carries neither.
 */
export function gradedOf(input: GradeInput): Graded | undefined {
  if (input.grade !== undefined) {
    return { grade: input.grade, timedOut: input.timedOut ?? false };
  }
  return input.result === undefined ? undefined : FROM_RESULT[input.result];
}

/**
 * What the figures count a graded answer as: said in time when graded hard or
 * good before the timer ran out, a timeout whatever the grade, else a miss.
 */
export function resultOf(graded: Graded): AnswerResult {
  if (graded.timedOut) {
    return "timeout";
  }
  return graded.grade === "again" ? "ng" : "ok";
}

/** A review's grade, read from its result when it was logged before three grades. */
export function gradeOf(detail: CompositionDetail): Graded {
  return detail.grade === undefined
    ? FROM_RESULT[detail.result]
    : { grade: detail.grade, timedOut: detail.timedOut ?? false };
}

/**
 * Whether an answer for `day` moves the item's schedule: only its first
 * answer of a practice day does. A re-ask, any later answer that day and an
 * answer for an earlier day are logged with the state they found.
 */
export function movesItem(
  progress: ItemProgress | undefined,
  pass: Pass,
  day: DayKey,
): boolean {
  const lastDay = progress?.fsrs?.lastDay;
  return pass === "first" && (lastDay === undefined || lastDay < day);
}

/**
 * Days until each grade would bring the card back, were it first answered on
 * `day`. A card seen only before FSRS has no state, so it takes a new card's.
 */
export function intervalsOf(
  state: FsrsState | undefined,
  day: DayKey,
  cardId: string,
): Readonly<Record<FsrsGrade, number>> {
  const preview = previewGrades(state, day, cardId);
  return {
    again: preview.again.intervalDays,
    hard: preview.hard.intervalDays,
    good: preview.good.intervalDays,
  };
}
