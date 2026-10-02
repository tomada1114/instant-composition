import {
  decideVocabAnswers,
  err,
  ok,
  vocabFigures,
  type Result,
  type VocabAnswer,
  type VocabReview,
} from "@instant-composition/domain";

import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { committed, storeFor, type ApplicationDeps, type Write } from "./execute";
import type { LearnerStore } from "./store";
import type { CatalogSnapshot } from "./catalog";
import { loadVocab, summaryOf, vocabSnapshots } from "./vocab-load";
import { shownCards } from "./vocab-shown";
import type { VocabSummary } from "./vocab-views";

export interface VocabAnswersCommand {
  readonly sessionId: string;
  readonly answers: readonly VocabAnswer[];
}

/**
 * Answers per commit: each puts a review and at most a card's progress, and
 * the session is written once, which keeps a commit well inside the store's
 * limit for the largest batch the contract takes.
 */
const ANSWERS_PER_COMMIT = 40;

type Snapshots = ReadonlyMap<string, VocabReview["snapshot"]>;

/** What a review keeps of each card an answer may name: the catalog's and the learner's own. */
async function snapshotsOf(
  store: LearnerStore,
  snapshot: CatalogSnapshot,
): Promise<Snapshots> {
  return vocabSnapshots(shownCards(snapshot, await store.cards()));
}

function recordChunk(
  store: LearnerStore,
  snapshots: Snapshots,
  context: RequestContext,
  command: VocabAnswersCommand,
  chunk: readonly VocabAnswer[],
): Promise<Result<undefined, ApplicationError>> {
  return committed(store, async () => {
    const session = await store.vocabSession(command.sessionId);
    if (session === undefined) {
      return err({ code: "ERR_SESSION_NOT_FOUND" });
    }
    const [reviews, items] = await Promise.all([
      store.vocabReviewsOf(command.sessionId),
      store.vocabItems(),
    ]);
    const state = {
      session: session.value,
      progress: new Map([...items].map(([id, stored]) => [id, stored.value])),
      recorded: new Set(reviews.map((review) => review.id)),
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
    return ok({ value: undefined, writes });
  });
}

async function recordInto(
  store: LearnerStore,
  snapshots: Snapshots,
  context: RequestContext,
  command: VocabAnswersCommand,
): Promise<Result<undefined, ApplicationError>> {
  const chunks: VocabAnswer[][] = [];
  for (let start = 0; start < command.answers.length; start += ANSWERS_PER_COMMIT) {
    chunks.push(command.answers.slice(start, start + ANSWERS_PER_COMMIT));
  }
  for (const chunk of chunks.length === 0 ? [[]] : chunks) {
    const recorded = await recordChunk(store, snapshots, context, command, chunk);
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
  const snapshots = await snapshotsOf(bound.value, snapshot.value);
  return recordInto(bound.value, snapshots, context, command);
}

/**
 * Takes in the session's last answers, then closes it and keeps tomorrow's
 * count. A finished session answers with the summary it kept, so finishing
 * twice is safe.
 */
export async function finishVocabSession(
  deps: ApplicationDeps,
  context: RequestContext,
  command: VocabAnswersCommand,
): Promise<Result<VocabSummary, ApplicationError>> {
  const bound = storeFor(deps, context, "finishVocabSession");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  const kept = async (): Promise<
    Result<VocabSummary, ApplicationError> | undefined
  > => {
    const session = await store.vocabSession(command.sessionId);
    if (session === undefined) {
      return err({ code: "ERR_SESSION_NOT_FOUND" });
    }
    return session.value.finishedAt === null
      ? undefined
      : ok(summaryOf(session.value, await store.vocabReviewsOf(command.sessionId)));
  };
  const before = await kept();
  if (before !== undefined) {
    return before;
  }
  const snapshot = await deps.catalog.snapshot();
  if (!snapshot.ok) {
    return snapshot;
  }
  const snapshots = await snapshotsOf(store, snapshot.value);
  const recorded = await recordInto(store, snapshots, context, command);
  if (!recorded.ok) {
    return recorded.error.code === "ERR_SESSION_CLOSED"
      ? ((await kept()) ?? recorded)
      : recorded;
  }
  return committed(store, async () => {
    const session = await store.vocabSession(command.sessionId);
    if (session === undefined) {
      return err({ code: "ERR_SESSION_NOT_FOUND" });
    }
    const reviews = await store.vocabReviewsOf(command.sessionId);
    if (session.value.finishedAt !== null) {
      return ok({ value: summaryOf(session.value, reviews), writes: [] });
    }
    const loaded = await loadVocab(store, deps.catalog, context, session.value.day);
    if (!loaded.ok) {
      return loaded;
    }
    const finished = {
      ...session.value,
      finishedAt: context.now,
      tomorrow: vocabFigures(loaded.value.state).tomorrow,
    };
    return ok({
      value: summaryOf(finished, reviews),
      writes: [[{ type: "vocabSession", value: finished }, session]],
    });
  });
}
