import {
  DEFAULT_SETTINGS,
  err,
  ok,
  withDefaults,
  type Result,
} from "@instant-composition/domain";

import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { committed, storeFor, type ApplicationDeps } from "./execute";
import { summaryOf } from "./vocab-load";
import { recordVocabInto, type VocabAnswersCommand } from "./vocab-answers";
import type { Commit } from "./store";
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
  return committed<VocabSummary>(store, async () => {
    const session = await store.vocabSession(command.sessionId);
    if (session === undefined) {
      return err({ code: "ERR_SESSION_NOT_FOUND" });
    }
    const reviews = await store.vocabReviewsOf(command.sessionId);
    if (session.value.finishedAt !== null) {
      return ok({ value: summaryOf(session.value, reviews), writes: [] });
    }
    let tomorrow: number;
    let expect: Commit["expect"];
    {
      const [model, source, settings] = await Promise.all([
        store.vocabReadModel(session.value.day),
        store.readModelSource(),
        store.settings(),
      ]);
      if (
        model?.value.schema !== 1 ||
        (model.value.expiresAt !== undefined &&
          model.value.expiresAt * 1_000 <= context.now) ||
        model.value.status !== "ready" ||
        model.value.catalog !== snapshot.value.version ||
        model.value.sourceVersion !== (source?.version ?? 0)
      ) {
        const requested = await store.vocabReadModelRequest(session.value.day);
        if (requested === undefined)
          await store.commit({
            puts: [
              {
                type: "vocabReadModelRequest",
                value: { schema: 1, day: session.value.day },
              },
            ],
            updates: [],
            expect: [],
          });
        return err({ code: "ERR_READ_MODEL_NOT_READY" });
      }
      const due = model.value.counts.reduce(
        (total, count) => total + count.tomorrow,
        0,
      );
      const limit = withDefaults(
        settings?.value ?? DEFAULT_SETTINGS,
      ).vocabReviewsPerDay;
      tomorrow = limit === null ? due : Math.min(due, limit);
      expect = [
        { key: { type: "readModelSource" }, version: source?.version ?? null },
        {
          key: { type: "vocabReadModel", day: session.value.day },
          version: model.version,
        },
        { key: { type: "settings" }, version: settings?.version ?? null },
      ];
    }
    const finished = {
      ...session.value,
      finishedAt: context.now,
      tomorrow,
    };
    return ok({
      value: summaryOf(finished, reviews),
      writes: [[{ type: "vocabSession", value: finished }, session]],
      expect,
    });
  });
}
