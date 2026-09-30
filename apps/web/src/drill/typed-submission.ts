import { useEffect } from "react";

import type { QueueStorage } from "./answer-queue";
import { currentCard, type DrillState, type Submission } from "./drill-state";

const PREFIX = "drill-typed:";
const PASSES: readonly unknown[] = ["first", "retry"];

/** The typed card on show with its back turned and no grade yet, if there is one. */
function submissionOf(state: DrillState): Submission | undefined {
  const { phase } = state;
  const card = currentCard(state);
  if (!state.typed || card === undefined) return undefined;
  if (phase.kind !== "back" || phase.mode !== "self") return undefined;
  const submission = { ...card, elapsedMs: Math.round(phase.elapsedMs) };
  return phase.text === undefined ? submission : { ...submission, text: phase.text };
}

/** Whether `value` is a submission as `keepSubmission` stored it; storage is the browser's, so it is read as untrusted. */
function isSubmission(value: unknown): value is Submission {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<Record<keyof Submission, unknown>>;
  return (
    typeof entry.cardId === "string" &&
    PASSES.includes(entry.pass) &&
    Number.isInteger(entry.elapsedMs) &&
    (entry.elapsedMs as number) >= 0 &&
    (entry.text === undefined || typeof entry.text === "string")
  );
}

/** What an earlier page of this tab submitted in round `roundId` and left ungraded. */
export function loadSubmission(
  storage: QueueStorage | undefined,
  roundId: string,
): Submission | undefined {
  try {
    const raw = storage?.getItem(`${PREFIX}${roundId}`);
    if (raw === null || raw === undefined) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isSubmission(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Writes `raw`, a stored submission, under round `roundId`; an empty `raw` removes it. */
function write(storage: QueueStorage | undefined, roundId: string, raw: string): void {
  try {
    if (raw === "") storage?.removeItem(`${PREFIX}${roundId}`);
    else storage?.setItem(`${PREFIX}${roundId}`, raw);
  } catch {
    // Storage may be full or blocked; the round then reopens on the card's front.
  }
}

/**
 * Keeps a typed round's submitted, ungraded card in `storage`, so a round
 * left or reloaded on that back reopens on it with its text rather than
 * asking for it again. A spoken round, and the start screen, store nothing.
 */
export function useKeptSubmission(
  state: DrillState,
  storage: QueueStorage | undefined,
): void {
  const idle = !state.typed || state.phase.kind === "intro";
  const submission = idle ? undefined : submissionOf(state);
  const raw = submission === undefined ? "" : JSON.stringify(submission);
  const { roundId } = state;
  useEffect(() => {
    if (!idle) write(storage, roundId, raw);
  }, [idle, raw, roundId, storage]);
}
