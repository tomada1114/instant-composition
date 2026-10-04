import { ok, type DayKey, type Result } from "@instant-composition/domain";
import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { storeFor, type ApplicationDeps } from "./execute";
import type { LearnerStore } from "./store";
import { rebuildVocabReadModel } from "./rebuild-read-model";

/** One queued day per tick. Completed requests disappear; no candidate row discovers work. */
export async function advanceRequestedVocabDay(
  deps: ApplicationDeps,
  context: RequestContext,
): Promise<
  Result<{ readonly complete: boolean; readonly rows: number }, ApplicationError>
> {
  const bound = storeFor(deps, context, "rebuildProjections");
  if (!bound.ok) return bound;
  const store = bound.value;
  const page = await store.vocabReadModelRequests(null);
  const requested = page.rows[0];
  if (requested === undefined) return ok({ complete: true, rows: 0 });
  const day = requested.value.day;
  const step = await rebuildVocabReadModel(deps, context, day);
  if (!step.ok) return step;
  if (step.value.status !== "ready")
    return ok({ complete: false, rows: step.value.rows });
  const [model, source] = await Promise.all([
    store.vocabReadModel(day),
    store.readModelSource(),
  ]);
  if (model?.value.sourceVersion !== (source?.version ?? 0))
    return ok({ complete: false, rows: step.value.rows });
  const removed = await store.commit({
    puts: [],
    updates: [],
    deletes: [
      { key: { type: "vocabReadModelRequest", day }, version: requested.version },
    ],
    expect: [
      { key: { type: "vocabReadModel", day }, version: model.version },
      { key: { type: "readModelSource" }, version: source?.version ?? null },
    ],
  });
  return removed.ok ? ok({ complete: false, rows: step.value.rows }) : removed;
}

/** Authenticated commands enqueue a stale original day; queries never advance maintenance. */
export async function requestVocabDay(store: LearnerStore, day: DayKey): Promise<void> {
  if ((await store.vocabReadModelRequest(day)) !== undefined) return;
  await store.commit({
    puts: [{ type: "vocabReadModelRequest", value: { schema: 1, day } }],
    updates: [],
    expect: [],
  });
}
