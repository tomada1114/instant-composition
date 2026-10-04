import { err, ok, vocabFigures, type Result } from "@instant-composition/domain";

import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { committed, storeFor, type ApplicationDeps } from "./execute";
import { loadVocab, summaryOf } from "./vocab-load";
import { recordVocabInto, type VocabAnswersCommand } from "./vocab-answers";
import type { VocabSummary } from "./vocab-views";

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
  const recorded = await recordVocabInto(store, snapshot.value, context, command);
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
