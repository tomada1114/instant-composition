import { addDays, EMPTY_STATS, type DayKey } from "@instant-composition/domain";
import type { RequestContext } from "./context";
import { commitOf, todayOf, type ApplicationDeps, type Write } from "./execute";
import { compositionSchemaSupported } from "./composition-model";
import type {
  CompositionBuild,
  CompositionIdentity,
  CompositionMaintenanceStep,
} from "./composition-model";
import { accumulateComposition } from "./composition-aggregate";
import { publishComposition } from "./composition-preview";
import { migrateStreakStep } from "./streak-migration";
import { compositionCandidate } from "./composition-candidate";

export function sameCompositionIdentity(
  a: CompositionIdentity,
  b: CompositionIdentity,
): boolean {
  return (
    a.day === b.day &&
    a.epoch === b.epoch &&
    a.catalogVersion === b.catalogVersion &&
    a.settingsVersion === b.settingsVersion &&
    a.statsVersion === b.statsVersion &&
    a.portionVersion === b.portionVersion &&
    a.tallyVersion === b.tallyVersion
  );
}
/** One independent maintenance step reads ten progress rows and materializes their live candidates. */
export async function rebuildCompositionReadModel(
  deps: ApplicationDeps,
  context: RequestContext,
  day: DayKey = todayOf(context),
): Promise<CompositionMaintenanceStep> {
  if (
    context.actor.kind !== "system" ||
    context.actor.onBehalfOf !== context.learner.id ||
    (day !== todayOf(context) && day !== addDays(todayOf(context), 1))
  )
    throw new RangeError(
      "Composition maintenance needs a trusted current or next-day system context.",
    );
  const store = deps.stores.forLearner(context.learner.id);
  const snapshot = await deps.catalog.snapshot();
  if (!snapshot.ok) return { status: "building", rows: 0, day };
  const [source, storedStats, settings, portion, tallies, published, checkpoint] =
    await Promise.all([
      store.compositionSource(),
      store.stats(),
      store.settings(),
      store.portion(day),
      store.days([day]),
      store.compositionReadModel(day),
      store.compositionBuild(day),
    ]);
  if (storedStats !== undefined && storedStats.value.streak === undefined) {
    await migrateStreakStep(store, storedStats);
    return { status: "building", rows: 0, day };
  }
  if (
    (storedStats?.value.streak !== undefined &&
      !compositionSchemaSupported(storedStats.value.streak)) ||
    (published !== undefined && !compositionSchemaSupported(published.value)) ||
    (checkpoint !== undefined && !compositionSchemaSupported(checkpoint.value))
  )
    return { status: "building", rows: 0, day };
  if (source !== undefined && !compositionSchemaSupported(source.value))
    return { status: "building", rows: 0, day };
  const tally = tallies.get(day);
  const identity: CompositionIdentity = {
    day,
    epoch: source?.value.epoch ?? 0,
    catalogVersion: snapshot.value.version,
    settingsVersion: settings?.version ?? null,
    statsVersion: storedStats?.version ?? null,
    portionVersion: portion?.version ?? null,
    tallyVersion: tally?.version ?? null,
  };
  if (
    published !== undefined &&
    (published.value.expiresAt === undefined ||
      published.value.expiresAt * 1_000 > context.now) &&
    sameCompositionIdentity(published.value, identity)
  )
    return { status: "ready", rows: 0, day };
  const started =
    checkpoint === undefined ||
    (checkpoint.value.expiresAt !== undefined &&
      checkpoint.value.expiresAt * 1_000 <= context.now) ||
    !sameCompositionIdentity(checkpoint.value, identity);
  let build: CompositionBuild = started
    ? {
        ...identity,
        generation: `${day}:${snapshot.value.version}:${String(identity.epoch)}:${String((checkpoint?.version ?? 0) + 1)}`,
        expiresAt: Math.floor(context.now / 1_000) + 3 * 86_400,
        schema: 1,
        phase: "items",
        cursor: null,
        known: "0".repeat(snapshot.value.shown.size),
        answered: 0,
        newAnswered: 0,
        due: 0,
        notDue: 0,
        notDueTop: [],
        conceptFirst: {},
        notDueConceptFirst: {},
        notDueConceptRanks: {},
        conceptRanks: {},
        concepts: {},
        subtopics: {},
        reach: {},
        breakdown: {},
        pending: 0,
      }
    : checkpoint.value;
  const page = await store.compositionItemsPage({
    limit: 10,
    ...(build.cursor === null ? {} : { cursor: build.cursor }),
  });
  build = {
    ...accumulateComposition(
      build,
      page.entries.map(({ value }) => value),
      snapshot.value,
      settings?.value.topics ?? [],
    ),
    cursor: page.cursor,
  };
  const writes: Write[] =
    build.phase === "items"
      ? page.entries.flatMap(({ value }): Write[] => {
          const candidate = compositionCandidate(
            value,
            build,
            snapshot.value,
            settings?.value.topics ?? [],
          );
          return candidate === undefined
            ? []
            : [[{ type: "compositionCandidate", value: candidate }, undefined]];
        })
      : [];
  const publishing = page.cursor === null && build.phase === "ranks";
  if (page.cursor === null && build.phase === "items")
    build = { ...build, phase: "ranks", cursor: null };
  else if (page.cursor === null)
    writes.push([
      {
        type: "compositionReadModel",
        value: publishComposition(
          build,
          snapshot.value,
          settings?.value,
          storedStats?.value ?? EMPTY_STATS,
          portion?.value.target,
          tally?.value.roundsStarted ?? 0,
        ),
      },
      published,
    ]);
  writes.push([{ type: "compositionBuild", value: build }, checkpoint]);
  const result = await store.commit(
    commitOf(
      writes,
      [],
      [{ key: { type: "compositionSource" }, version: source?.version ?? null }],
    ),
  );
  return {
    status: !result.ok || started ? "restarted" : publishing ? "ready" : "building",
    rows: page.entries.length,
    day,
  };
}
