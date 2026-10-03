import type { AnswerInput } from "./study-state";
import { readAnswer } from "./stored-answer";

export interface StoredQueue {
  readonly answers: AnswerInput[];
  readonly retryAt: number;
}

/** Old answer arrays and current deferred queues both retain their original IDs. */
export function readQueue(read: () => string | null | undefined): StoredQueue {
  const empty = { answers: [], retryAt: 0 };
  try {
    const raw = read();
    if (raw === null || raw === undefined) return empty;
    const parsed: unknown = JSON.parse(raw);
    const envelope = typeof parsed === "object" && parsed !== null ? parsed : {};
    const entries: unknown = Array.isArray(parsed)
      ? parsed
      : "answers" in envelope
        ? envelope.answers
        : undefined;
    if (!Array.isArray(entries)) return empty;
    const answers = entries.map(readAnswer);
    if (!answers.every((answer) => answer !== undefined)) return empty;
    const deadline = "retryAt" in envelope ? envelope.retryAt : undefined;
    return {
      answers,
      retryAt:
        typeof deadline === "number" && Number.isSafeInteger(deadline) && deadline >= 0
          ? deadline
          : 0,
    };
  } catch {
    return empty;
  }
}

/** A deadline may belong to the finish request even when every answer is saved. */
export function queueText(
  answers: readonly AnswerInput[],
  retryAt: number,
): string | undefined {
  if (answers.length === 0 && retryAt === 0) return undefined;
  return JSON.stringify(retryAt > 0 ? { answers, retryAt } : answers);
}
