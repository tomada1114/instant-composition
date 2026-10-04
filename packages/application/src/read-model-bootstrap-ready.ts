import { addDays } from "@instant-composition/domain";
import { readModelSchemaSupported } from "./read-model";
import type { RequestContext } from "./context";
import { todayOf, type ApplicationDeps } from "./execute";

/** Strong bounded points verify the vocab slice and a drained requested-day queue. */
export async function vocabReadModelsReady(
  deps: ApplicationDeps,
  context: RequestContext,
): Promise<number | undefined> {
  if (
    context.actor.kind !== "system" ||
    context.actor.onBehalfOf !== context.learner.id
  )
    throw new RangeError("Bootstrap readiness needs its trusted learner context.");
  const store = deps.stores.forLearner(context.learner.id);
  const snapshot = await deps.catalog.snapshot();
  if (!snapshot.ok) return undefined;
  const today = todayOf(context);
  const [source, current, next, requested] = await Promise.all([
    store.readModelSource(),
    store.vocabReadModel(today),
    store.vocabReadModel(addDays(today, 1)),
    store.vocabReadModelRequests(null),
  ]);
  if (source !== undefined && !readModelSchemaSupported(source.value)) return undefined;
  if (requested.rows.length !== 0 || requested.cursor !== null) return undefined;
  let expires = Infinity;
  for (const [day, model] of [
    [today, current],
    [addDays(today, 1), next],
  ] as const) {
    if (
      model === undefined ||
      !readModelSchemaSupported(model.value) ||
      model.value.day !== day ||
      model.value.status !== "ready" ||
      model.value.catalog !== snapshot.value.version ||
      model.value.sourceVersion !== (source?.version ?? 0)
    )
      return undefined;
    expires = Math.min(expires, (model.value.expiresAt ?? Infinity) * 1_000);
  }
  const after = await store.readModelSource();
  return (after?.version ?? null) === (source?.version ?? null) && expires > context.now
    ? expires
    : undefined;
}
