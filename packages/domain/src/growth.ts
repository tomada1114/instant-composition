import { TUNING } from "./tuning";
import type { AnswerRecord } from "./types";

export interface GrowthInput {
  readonly roundId: string;
  /** Every stored answer, this round's included. */
  readonly answers: readonly AnswerRecord[];
  /** Cards that exist and are shown now; the rest are not compared. */
  readonly existing: ReadonlySet<string>;
}

export interface GrowthRow {
  readonly cardId: string;
  readonly prompt: string | null;
  /** `faster`: correct both times and quicker now. `fixed`: missed last time, correct now. */
  readonly kind: "faster" | "fixed";
  /** Last time's elapsed minus this time's; the list is sorted on it. */
  readonly deltaMs: number;
}

export interface Growth {
  readonly faster: number;
  readonly fixed: number;
  readonly compared: number;
  readonly firstTime: number;
  readonly rows: readonly GrowthRow[];
}

/**
 * This round's first-pass answers against each card's previous first-pass
 * answer from an earlier round, on any day.
 */
export function roundGrowth(input: GrowthInput): Growth {
  const firstPass = input.answers
    .filter((answer) => answer.pass === "first")
    .sort((a, b) => a.answeredAt - b.answeredAt);
  const current = firstPass.filter(
    (answer) => answer.roundId === input.roundId && input.existing.has(answer.cardId),
  );

  let compared = 0;
  let firstTime = 0;
  const rows: GrowthRow[] = [];
  for (const answer of current) {
    const previous = firstPass.findLast(
      (candidate) =>
        candidate.cardId === answer.cardId &&
        candidate.roundId !== input.roundId &&
        candidate.answeredAt < answer.answeredAt,
    );
    if (previous === undefined) {
      firstTime += 1;
      continue;
    }
    compared += 1;
    if (answer.result !== "ok") {
      continue;
    }
    const deltaMs = previous.elapsedMs - answer.elapsedMs;
    const row = { cardId: answer.cardId, prompt: answer.prompt, deltaMs };
    if (previous.result !== "ok") {
      rows.push({ ...row, kind: "fixed" });
    } else if (deltaMs >= TUNING.growth.fasterThresholdMs) {
      rows.push({ ...row, kind: "faster" });
    }
  }

  rows.sort((a, b) => b.deltaMs - a.deltaMs);
  return {
    faster: rows.filter((row) => row.kind === "faster").length,
    fixed: rows.filter((row) => row.kind === "fixed").length,
    compared,
    firstTime,
    rows,
  };
}

export interface ReviewRow {
  readonly cardId: string;
  readonly prompt: string | null;
}

/** This round's first-pass misses, in the order they were shown. */
export function reviewList(
  roundId: string,
  answers: readonly AnswerRecord[],
): ReviewRow[] {
  return answers
    .filter(
      (answer) =>
        answer.roundId === roundId && answer.pass === "first" && answer.result !== "ok",
    )
    .sort((a, b) => a.answeredAt - b.answeredAt)
    .map((answer) => ({ cardId: answer.cardId, prompt: answer.prompt }));
}
