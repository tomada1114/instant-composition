import { nextCardState } from "./card-state";
import type {
  FirstPassMark,
  ItemProgress,
  ItemSnapshot,
  Outcome,
  ReviewEntry,
} from "./records";
import { isFast } from "./timer";
import type { AnswerResult, DayKey, Pass } from "./types";

/** Everything known of one answer once it is accepted into a round. */
export interface AcceptedAnswer {
  readonly id: string;
  readonly sessionId: string;
  readonly cardId: string;
  readonly pass: Pass;
  readonly result: AnswerResult;
  readonly elapsedMs: number;
  readonly limitMs: number;
  readonly day: DayKey;
  readonly answeredAt: number;
  readonly snapshot: ItemSnapshot;
}

/** `ng` and a timeout are "again", a fast correct answer "easy", any other "good". */
export function outcomeOf(
  result: AnswerResult,
  elapsedMs: number,
  limitMs: number,
): Outcome {
  if (result !== "ok") {
    return "again";
  }
  return isFast(elapsedMs, limitMs) ? "easy" : "good";
}

/** The item after a first-pass answer; a retry leaves it as it was. */
function advance(progress: ItemProgress | undefined, entry: ReviewEntry): ItemProgress {
  const { detail } = entry;
  const memory = entry.after ?? progress?.memory;
  if (memory === undefined) {
    throw new RangeError("A first-pass review always leaves a memory state.");
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
    memory,
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
 * after it. Only a first pass moves the item.
 */
export function reviewAnswer(
  progress: ItemProgress | undefined,
  answer: AcceptedAnswer,
): { readonly entry: ReviewEntry; readonly progress: ItemProgress | undefined } {
  const before = progress?.memory ?? null;
  const entry: ReviewEntry = {
    id: answer.id,
    item: { kind: "composition", id: answer.cardId },
    sessionId: answer.sessionId,
    answeredAt: answer.answeredAt,
    day: answer.day,
    outcome: outcomeOf(answer.result, answer.elapsedMs, answer.limitMs),
    before,
    after:
      answer.pass === "first" ? nextCardState(before ?? undefined, answer) : before,
    snapshot: answer.snapshot,
    detail: {
      activity: "composition",
      pass: answer.pass,
      result: answer.result,
      elapsedMs: answer.elapsedMs,
      limitMs: answer.limitMs,
    },
  };
  return {
    entry,
    progress: answer.pass === "first" ? advance(progress, entry) : progress,
  };
}

/** The log in the order the store reads it back: by time, then by id. */
export function logOrder(a: ReviewEntry, b: ReviewEntry): number {
  return a.answeredAt - b.answeredAt || a.id.localeCompare(b.id);
}

/** Every item's progress, rebuilt from the log alone. */
export function replayItems(log: readonly ReviewEntry[]): Map<string, ItemProgress> {
  const items = new Map<string, ItemProgress>();
  for (const entry of [...log].sort(logOrder)) {
    if (entry.detail.pass === "first") {
      items.set(entry.item.id, advance(items.get(entry.item.id), entry));
    }
  }
  return items;
}
