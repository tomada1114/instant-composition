import type { AnswerInput } from "./drill-state";

const PASSES: readonly unknown[] = ["first", "retry"];
const GRADES: readonly unknown[] = ["again", "hard", "good"];
/** An earlier build's `result`, as the server takes it: `ok` is ○, the rest ×. */
const RESULT_GRADES: Readonly<Record<string, Pick<AnswerInput, "grade" | "timedOut">>> =
  {
    ok: { grade: "good", timedOut: false },
    ng: { grade: "again", timedOut: false },
    timeout: { grade: "again", timedOut: true },
  };

/**
 * One answer as this queue stored it, or `undefined`: storage is the
 * browser's, so it is read as untrusted. One an earlier build stored with a
 * `result` in place of a grade is read as the server reads it.
 */
export function readAnswer(value: unknown): AnswerInput | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const entry = value as Partial<Record<keyof AnswerInput | "result", unknown>>;
  const graded =
    GRADES.includes(entry.grade) && typeof entry.timedOut === "boolean"
      ? { grade: entry.grade as AnswerInput["grade"], timedOut: entry.timedOut }
      : typeof entry.result === "string" && Object.hasOwn(RESULT_GRADES, entry.result)
        ? RESULT_GRADES[entry.result]
        : undefined;
  if (
    graded === undefined ||
    typeof entry.id !== "string" ||
    typeof entry.roundId !== "string" ||
    typeof entry.cardId !== "string" ||
    !PASSES.includes(entry.pass) ||
    typeof entry.elapsedMs !== "number" ||
    !Number.isInteger(entry.elapsedMs) ||
    (entry.answeredAt !== undefined && !Number.isInteger(entry.answeredAt))
  )
    return undefined;
  return {
    id: entry.id,
    roundId: entry.roundId,
    cardId: entry.cardId,
    pass: entry.pass as AnswerInput["pass"],
    ...graded,
    elapsedMs: entry.elapsedMs,
    ...(typeof entry.answeredAt === "number" ? { answeredAt: entry.answeredAt } : {}),
  };
}
