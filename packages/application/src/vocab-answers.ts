import {
  decideVocabAnswers,
  err,
  ok,
  type Result,
  type VocabAnswer,
} from "@instant-composition/domain";

import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { committed, storeFor, type ApplicationDeps, type Write } from "./execute";
import type { Commit, LearnerStore } from "./store";
import type { CatalogSnapshot } from "./catalog";
import { vocabSnapshots } from "./vocab-load";
import { shownCards } from "./vocab-shown";

export interface VocabAnswersCommand {
  readonly sessionId: string;
  readonly answers: readonly VocabAnswer[];
}

/** Each source change also maintains both prepared days, so chunks reserve projection actions. */
const ANSWERS_PER_COMMIT = 2;

function recordChunk(
  store: LearnerStore,
  snapshot: CatalogSnapshot,
  context: RequestContext,
  command: VocabAnswersCommand,
  chunk: readonly VocabAnswer[],
): Promise<Result<undefined, ApplicationError>> {
  return committed(store, async () => {
    const session = await store.vocabSession(command.sessionId);
    if (session === undefined) {
      return err({ code: "ERR_SESSION_NOT_FOUND" });
    }
    const [reviews, items, cards] = await Promise.all([
      store.vocabReviewsByIds(
        command.sessionId,
        command.answers.map((answer) => answer.id),
      ),
      store.vocabItemsByIds(chunk.map((answer) => answer.cardId)),
      store.cardsByIds(chunk.map((answer) => answer.cardId)),
    ]);
    const wanted = new Set(chunk.map((answer) => answer.cardId));
    const vocab = new Map(
      [...wanted].flatMap((id) => {
        const card = snapshot.vocab.get(id);
        return card === undefined ? [] : [[id, card] as const];
      }),
    );
    const snapshots = vocabSnapshots(shownCards({ ...snapshot, vocab }, cards));
    const state = {
      session: session.value,
      progress: new Map([...items].map(([id, stored]) => [id, stored.value])),
      recorded: new Set(reviews.keys()),
    };
    // The whole batch is checked before its first chunk is written.
    const checked = decideVocabAnswers(state, command.answers, snapshots, context.now);
    const decided = checked.ok
      ? decideVocabAnswers(state, chunk, snapshots, context.now)
      : checked;
    if (!decided.ok) {
      return decided;
    }
    const { entries, moved } = decided.value;
    if (entries.length === 0) {
      return ok({ value: undefined, writes: [] });
    }
    const writes: Write[] = [
      ...entries.map((value): Write => [{ type: "vocabReview", value }, undefined]),
      ...moved.map((value): Write => [
        { type: "vocabItem", value },
        items.get(value.cardId),
      ]),
      // Written unchanged, so a finish racing these answers makes one of them load again.
      [{ type: "vocabSession", value: session.value }, session],
    ];
    const changed = new Set(moved.map((item) => item.cardId));
    const held = [...new Set(entries.map((entry) => entry.cardId))];
    const expect: Commit["expect"][number][] = held.flatMap((id) => {
      const card = cards.get(id);
      return card === undefined
        ? []
        : [{ key: { type: "card" as const, id }, version: card.version }];
    });
    expect.push(
      ...held
        .filter((id) => !changed.has(id))
        .map((cardId) => ({
          key: { type: "vocabItem" as const, cardId },
          version: items.get(cardId)?.version ?? null,
        })),
    );
    return ok({ value: undefined, writes, expect });
  });
}

export async function recordVocabInto(
  store: LearnerStore,
  snapshot: CatalogSnapshot,
  context: RequestContext,
  command: VocabAnswersCommand,
): Promise<Result<undefined, ApplicationError>> {
  const chunks: VocabAnswer[][] = [];
  for (let start = 0; start < command.answers.length; start += ANSWERS_PER_COMMIT) {
    chunks.push(command.answers.slice(start, start + ANSWERS_PER_COMMIT));
  }
  for (const chunk of chunks.length === 0 ? [[]] : chunks) {
    const recorded = await recordChunk(store, snapshot, context, command, chunk);
    if (!recorded.ok) {
      return recorded;
    }
  }
  return ok(undefined);
}

/**
 * Records a batch of a session's answers, ignoring ids it already holds; a
 * batch of held ids alone is taken, and writes nothing, after finish too. A
 * session crossing the day boundary keeps taking answers for the day it started.
 * Deleted personal cards are skipped on a fresh load; already logged answers stay.
 */
export async function recordVocabAnswers(
  deps: ApplicationDeps,
  context: RequestContext,
  command: VocabAnswersCommand,
): Promise<Result<undefined, ApplicationError>> {
  const bound = storeFor(deps, context, "recordVocabAnswers");
  if (!bound.ok) {
    return bound;
  }
  const snapshot = await deps.catalog.snapshot();
  if (!snapshot.ok) {
    return snapshot;
  }
  return recordVocabInto(bound.value, snapshot.value, context, command);
}
