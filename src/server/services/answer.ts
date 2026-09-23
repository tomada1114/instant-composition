import type { AnswerInput } from "../../core/api";
import { err, ok, type Result } from "../../core/result";
import { limitMsForWords } from "../../core/timer";
import { TUNING } from "../../core/tuning";
import type { AnswerRecord } from "../../core/types";
import type { ContentSnapshot } from "../content";
import type { RoundRow } from "../db";
import type { ServiceDeps, ServiceError } from "./deps";

/**
 * The stored form of one answer: the round's day, the limit worked out here
 * rather than trusted from the browser, and a copy of the card's placement so
 * the record outlives the card.
 */
function toRecord(
  input: AnswerInput,
  round: RoundRow,
  content: ContentSnapshot,
  answeredAt: number,
): AnswerRecord | undefined {
  const card = content.known.get(input.cardId);
  const tombstone = content.tombstones.get(input.cardId);
  const source = card ?? tombstone;
  if (source === undefined) {
    return undefined;
  }
  const limitMs =
    card === undefined ? TUNING.timer.minSeconds * 1000 : limitMsForWords(card.words);
  return {
    id: input.id,
    roundId: round.id,
    cardId: input.cardId,
    pass: input.pass,
    result: input.result,
    elapsedMs:
      input.result === "timeout" ? limitMs : Math.min(input.elapsedMs, limitMs),
    limitMs,
    day: round.day,
    answeredAt,
    topic: source.topic,
    subtopic: source.subtopic,
    level: source.level,
    ja: source.ja,
  };
}

/**
 * Stores `inputs` against an open `round`, ignoring ids already stored. A
 * round crossing the day boundary keeps taking answers: it belongs to the day
 * it started on.
 */
export function ingestAnswers(
  deps: ServiceDeps,
  round: RoundRow,
  inputs: readonly AnswerInput[],
): Result<undefined, ServiceError> {
  const loaded = deps.content.get();
  if (!loaded.ok) {
    return err({ code: "ERR_CONTENT_UNREADABLE" });
  }
  const records: AnswerRecord[] = [];
  for (const input of inputs) {
    if (input.roundId !== round.id || !round.deck.includes(input.cardId)) {
      return err({ code: "ERR_BAD_REQUEST" });
    }
    const record = toRecord(input, round, loaded.value, deps.now());
    if (record === undefined) {
      return err({ code: "ERR_BAD_REQUEST" });
    }
    records.push(record);
  }
  deps.store.transaction(() => {
    for (const record of records) {
      deps.store.insertAnswer(record);
    }
  });
  return ok(undefined);
}

export function recordAnswer(
  deps: ServiceDeps,
  input: AnswerInput,
): Result<undefined, ServiceError> {
  const round = deps.store.getRound(input.roundId);
  if (round === undefined) {
    return err({ code: "ERR_ROUND_NOT_FOUND" });
  }
  if (round.finishedAt !== null) {
    return err({ code: "ERR_ROUND_CLOSED" });
  }
  return ingestAnswers(deps, round, [input]);
}
