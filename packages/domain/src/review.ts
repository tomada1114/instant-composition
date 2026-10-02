import { movesItem, resultOf, type Graded } from "./card-state";
import { scheduleCard } from "./fsrs";
import type { FirstPassMark, ItemProgress, ItemSnapshot, ReviewEntry } from "./records";
import type { CardState, DayKey, Pass } from "./types";

/** Everything known of one answer once it is accepted into a round. */
export interface AcceptedAnswer extends Graded {
  readonly id: string;
  readonly sessionId: string;
  readonly cardId: string;
  readonly pass: Pass;
  readonly elapsedMs: number;
  readonly limitMs: number;
  /** The card's pace, which "fast" is judged by. */
  readonly paceMs: number;
  readonly day: DayKey;
  readonly answeredAt: number;
  readonly snapshot: ItemSnapshot;
}

/**
 * The item after a first-pass answer that moves it: its FSRS state from a
 * review logged since FSRS, its Leitner state from one logged before.
 */
function advance(progress: ItemProgress | undefined, entry: ReviewEntry): ItemProgress {
  const { detail } = entry;
  const memory =
    entry.fsrs === undefined ? (entry.after ?? undefined) : progress?.memory;
  const fsrs = entry.fsrs?.after ?? progress?.fsrs;
  if (memory === undefined && fsrs === undefined) {
    throw new RangeError("A first-pass review always leaves a schedule.");
  }
  const okDays =
    detail.result === "ok" && !(progress?.okDays ?? []).includes(entry.day)
      ? [...(progress?.okDays ?? []), entry.day].slice(0, 2)
      : (progress?.okDays ?? []);
  const mark: FirstPassMark = {
    sessionId: entry.sessionId,
    result: detail.result,
    elapsedMs: detail.elapsedMs,
    answeredAt: entry.answeredAt,
  };
  const last = progress?.last ?? null;
  return {
    item: entry.item,
    ...(memory === undefined ? {} : { memory }),
    ...(fsrs === undefined ? {} : { fsrs }),
    okDays,
    mastered:
      progress?.mastered ??
      (okDays.length >= 2 ? { day: entry.day, sessionId: entry.sessionId } : null),
    placement: { topic: entry.snapshot.topic, subtopic: entry.snapshot.subtopic },
    last: mark,
    previous:
      last !== null && last.sessionId !== entry.sessionId
        ? last
        : (progress?.previous ?? null),
  };
}

/**
 * Takes one answer into the log: the entry to append, and the item's progress
 * after it. Only a card's first answer of a practice day moves the item, by
 * its grade, timed out or not; a re-ask and a later answer are logged with
 * the state they found. A card seen only before FSRS is scheduled as new.
 */
export function reviewAnswer(
  progress: ItemProgress | undefined,
  answer: AcceptedAnswer,
): { readonly entry: ReviewEntry; readonly progress: ItemProgress | undefined } {
  const before = progress?.fsrs ?? null;
  const moves = movesItem(progress, answer.pass, answer.day);
  const leitner = progress?.memory ?? null;
  const entry: ReviewEntry = {
    id: answer.id,
    item: { kind: "composition", id: answer.cardId },
    sessionId: answer.sessionId,
    answeredAt: answer.answeredAt,
    day: answer.day,
    outcome: answer.grade,
    before: leitner,
    after: leitner,
    fsrs: {
      before,
      after: moves
        ? scheduleCard(before ?? undefined, answer.grade, answer.day, answer.cardId)
            .state
        : before,
    },
    snapshot: answer.snapshot,
    detail: {
      activity: "composition",
      pass: answer.pass,
      result: resultOf(answer),
      grade: answer.grade,
      timedOut: answer.timedOut,
      elapsedMs: answer.elapsedMs,
      limitMs: answer.limitMs,
      paceMs: answer.paceMs,
    },
  };
  return {
    entry,
    progress: moves ? advance(progress, entry) : progress,
  };
}

/** The log in the order the store reads it back: by time, then by id. */
export function logOrder(a: ReviewEntry, b: ReviewEntry): number {
  return a.answeredAt - b.answeredAt || a.id.localeCompare(b.id);
}

function sameState(a: CardState, b: CardState): boolean {
  return (
    a.box === b.box &&
    a.lastDay === b.lastDay &&
    a.dueDay === b.dueDay &&
    a.seenCount === b.seenCount
  );
}

/**
 * Whether an entry moved its item. Since FSRS, a move counts one more
 * repetition; before it, a first pass moved the Leitner state unless it came
 * late, which left the state as found.
 */
function movedItem(entry: ReviewEntry): boolean {
  if (entry.detail.pass !== "first") {
    return false;
  }
  if (entry.fsrs !== undefined) {
    const { before, after } = entry.fsrs;
    return after !== null && after.reps !== (before?.reps ?? 0);
  }
  return (
    entry.before === null ||
    entry.after === null ||
    !sameState(entry.before, entry.after)
  );
}

/**
 * Every item's progress, rebuilt from the log alone. Each review keeps the
 * state it left, so a replay copies it rather than scheduling again: a
 * scheduler change applies from the next answer on.
 */
export function replayItems(log: readonly ReviewEntry[]): Map<string, ItemProgress> {
  const items = new Map<string, ItemProgress>();
  for (const entry of [...log].sort(logOrder)) {
    if (movedItem(entry)) {
      items.set(entry.item.id, advance(items.get(entry.item.id), entry));
    }
  }
  return items;
}
