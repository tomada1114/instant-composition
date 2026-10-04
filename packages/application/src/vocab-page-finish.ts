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
import {
  recordPagedVocabAnswers,
  type VocabPagedAnswersCommand,
} from "./vocab-page-answers";
import { pagedSummaryOf, type VocabPagedSummary } from "./vocab-page-views";

/** The closed guard keeps aggregates; finish never materializes the full answer log. */
export async function finishPagedVocabSession(
  deps: ApplicationDeps,
  context: RequestContext,
  command: VocabPagedAnswersCommand,
): Promise<Result<VocabPagedSummary, ApplicationError>> {
  const bound = storeFor(deps, context, "finishVocabSession");
  if (!bound.ok) return bound;
  const store = bound.value;
  const before = await store.vocabPagedSession(command.sessionId);
  if (before === undefined) return err({ code: "ERR_SESSION_NOT_FOUND" });
  if (before.value.finishedAt !== null) return ok(pagedSummaryOf(before.value));
  const recorded = await recordPagedVocabAnswers(deps, context, command);
  if (!recorded.ok && recorded.error.code !== "ERR_SESSION_CLOSED") return recorded;
  return committed<VocabPagedSummary>(store, async () => {
    const existing = await store.vocabPagedSession(command.sessionId);
    if (existing === undefined) return err({ code: "ERR_SESSION_NOT_FOUND" });
    if (existing.value.finishedAt !== null)
      return ok({ value: pagedSummaryOf(existing.value), writes: [] });
    const [source, model, settings, snapshot] = await Promise.all([
      store.readModelSource(),
      store.vocabReadModel(existing.value.day),
      store.settings(),
      deps.catalog.snapshot(),
    ]);
    if (!snapshot.ok) return snapshot;
    if (
      model?.value.status !== "ready" ||
      (model.value.expiresAt !== undefined &&
        model.value.expiresAt * 1000 <= context.now) ||
      model.value.sourceVersion !== (source?.version ?? 0) ||
      model.value.catalog !== snapshot.value.version
    ) {
      const requested = await store.vocabReadModelRequest(existing.value.day);
      if (requested === undefined)
        await store.commit({
          puts: [
            {
              type: "vocabReadModelRequest",
              value: { schema: 1, day: existing.value.day },
            },
          ],
          updates: [],
          expect: [],
        });
      return err({ code: "ERR_READ_MODEL_NOT_READY" });
    }
    const count = model.value.counts.reduce((total, row) => total + row.tomorrow, 0);
    if (!Number.isSafeInteger(count)) return err({ code: "ERR_CONFLICT" });
    const limit = withDefaults(settings?.value ?? DEFAULT_SETTINGS).vocabReviewsPerDay;
    const finished = {
      ...existing.value,
      finishedAt: context.now,
      tomorrow: limit === null ? count : Math.min(count, limit),
    };
    return ok({
      value: pagedSummaryOf(finished),
      writes: [[{ type: "vocabPagedSession", value: finished }, existing]],
      expect: [
        { key: { type: "readModelSource" }, version: source?.version ?? null },
        {
          key: { type: "vocabReadModel", day: existing.value.day },
          version: model.version,
        },
        { key: { type: "settings" }, version: settings?.version ?? null },
      ],
    });
  });
}
