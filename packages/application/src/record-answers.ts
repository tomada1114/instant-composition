import {
  checkAnswers,
  decideAnswers,
  err,
  ok,
  type AnswerInput,
  type CardFacts,
  type Result,
} from "@instant-composition/domain";

import { cardFacts } from "./catalog";
import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { committed, storeFor, type ApplicationDeps, type Write } from "./execute";
import { itemValues, statsOf } from "./practice";
import type { LearnerStore } from "./store";

export interface RecordAnswersCommand {
  readonly roundId: string;
  readonly answers: readonly AnswerInput[];
}

/**
 * Answers per commit: each takes a review, at most an item, and the round,
 * portion, day and totals, which keeps a commit well inside the store's limit.
 */
const ANSWERS_PER_COMMIT = 20;

function recordChunk(
  store: LearnerStore,
  facts: ReadonlyMap<string, CardFacts>,
  context: RequestContext,
  command: RecordAnswersCommand,
  chunk: readonly AnswerInput[],
): Promise<Result<undefined, ApplicationError>> {
  return committed(store, async () => {
    const round = await store.round(command.roundId);
    if (round === undefined) {
      return err({ code: "ERR_ROUND_NOT_FOUND" });
    }
    const checked = checkAnswers(round.value, command.answers, facts);
    if (!checked.ok) {
      return checked;
    }
    const { portionDay, day } = round.value;
    const [reviews, stats, items, portion, tallies] = await Promise.all([
      store.reviewsOf(round.value.id),
      store.stats(),
      store.items(),
      portionDay === null ? undefined : store.portion(portionDay),
      store.days([day]),
    ]);
    const tally = tallies.get(day);
    const change = decideAnswers(
      {
        round: round.value,
        stats: statsOf({ stats }),
        portion: portion?.value,
        day: tally?.value,
        items: itemValues(items),
        recorded: new Set(reviews.map((review) => review.id)),
      },
      chunk,
      facts,
      context.now,
    );
    if (change === undefined) {
      return ok({ value: undefined, writes: [] });
    }
    const writes: Write[] = [
      ...change.entries.map((value): Write => [{ type: "review", value }, undefined]),
      ...change.items.map((value): Write => [
        { type: "item", value },
        items.get(value.item.id),
      ]),
      [{ type: "round", value: change.round }, round],
      [{ type: "day", value: change.day }, tally],
      [{ type: "stats", value: change.stats }, stats],
    ];
    if (change.portion !== undefined) {
      writes.push([{ type: "portion", value: change.portion }, portion]);
    }
    return ok({ value: undefined, writes });
  });
}

/** Takes a batch in, a commit per chunk; the whole batch is checked before any is written. */
export async function recordInto(
  store: LearnerStore,
  facts: ReadonlyMap<string, CardFacts>,
  context: RequestContext,
  command: RecordAnswersCommand,
): Promise<Result<undefined, ApplicationError>> {
  const chunks: AnswerInput[][] = [];
  for (let start = 0; start < command.answers.length; start += ANSWERS_PER_COMMIT) {
    chunks.push(command.answers.slice(start, start + ANSWERS_PER_COMMIT));
  }
  for (const chunk of chunks.length === 0 ? [[]] : chunks) {
    const recorded = await recordChunk(store, facts, context, command, chunk);
    if (!recorded.ok) {
      return recorded;
    }
  }
  return ok(undefined);
}

/**
 * Records answers against an open round, ignoring ids it already holds. A
 * round crossing the day boundary keeps taking answers for the day it started.
 */
export async function recordAnswers(
  deps: ApplicationDeps,
  context: RequestContext,
  command: RecordAnswersCommand,
): Promise<Result<undefined, ApplicationError>> {
  const bound = storeFor(deps, context, "recordAnswers");
  if (!bound.ok) {
    return bound;
  }
  const snapshot = await deps.catalog.snapshot();
  if (!snapshot.ok) {
    return snapshot;
  }
  return recordInto(bound.value, cardFacts(snapshot.value), context, command);
}
