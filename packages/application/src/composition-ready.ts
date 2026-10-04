import { addDays, type DayKey } from "@instant-composition/domain";
import type { RequestContext } from "./context";
import { todayOf, type ApplicationDeps } from "./execute";
import { sameCompositionIdentity } from "./composition-maintenance";
import { compositionSchemaSupported } from "./composition-model";

/** A bounded bootstrap check; publication and migration run in independent maintenance. */
export async function compositionReadModelsValidity(
  deps: ApplicationDeps,
  context: RequestContext,
  days: readonly DayKey[] = [todayOf(context), addDays(todayOf(context), 1)],
): Promise<number | undefined> {
  const today = todayOf(context);
  const tomorrow = addDays(today, 1);
  if (
    context.actor.kind !== "system" ||
    context.actor.onBehalfOf !== context.learner.id ||
    days.length === 0 ||
    days.length > 2 ||
    days.some((day) => day !== today && day !== tomorrow)
  )
    throw new RangeError(
      "Composition verification needs trusted current or next-day context.",
    );
  const store = deps.stores.forLearner(context.learner.id);
  const [catalog, source, settings, stats] = await Promise.all([
    deps.catalog.snapshot(),
    store.compositionSource(),
    store.settings(),
    store.stats(),
  ]);
  if (
    !catalog.ok ||
    (source !== undefined && !compositionSchemaSupported(source.value)) ||
    (stats !== undefined &&
      (stats.value.streak === undefined ||
        !compositionSchemaSupported(stats.value.streak)))
  )
    return undefined;
  const ready = await Promise.all(
    days.map(async (day) => {
      const [model, portion, tallies] = await Promise.all([
        store.compositionReadModel(day),
        store.portion(day),
        store.days([day]),
      ]);
      const matches =
        model !== undefined &&
        compositionSchemaSupported(model.value) &&
        (model.value.expiresAt === undefined ||
          model.value.expiresAt * 1_000 > context.now) &&
        sameCompositionIdentity(model.value, {
          day,
          epoch: source?.value.epoch ?? 0,
          catalogVersion: catalog.value.version,
          settingsVersion: settings?.version ?? null,
          statsVersion: stats?.version ?? null,
          portionVersion: portion?.version ?? null,
          tallyVersion: tallies.get(day)?.version ?? null,
        });
      return matches ? (model.value.expiresAt ?? Infinity) * 1_000 : undefined;
    }),
  );
  if (ready.some((value) => value === undefined)) return undefined;
  const [after, latestCatalog] = await Promise.all([
    store.compositionSource(),
    deps.catalog.snapshot(),
  ]);
  const matches =
    after?.version === source?.version &&
    latestCatalog.ok &&
    latestCatalog.value.version === catalog.value.version;
  return matches ? Math.min(...ready.map((value) => value ?? 0)) : undefined;
}

export async function compositionReadModelsReady(
  deps: ApplicationDeps,
  context: RequestContext,
  days?: readonly DayKey[],
): Promise<boolean> {
  return (await compositionReadModelsValidity(deps, context, days)) !== undefined;
}
