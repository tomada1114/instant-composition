import {
  EMPTY_STATS,
  err,
  ok,
  type DayKey,
  type DayTally,
  type LearnerStats,
  type Portion,
  type Result,
  type Settings,
} from "@instant-composition/domain";
import type { CatalogSnapshot } from "./catalog";
import { sameCompositionIdentity } from "./composition-maintenance";
import { publishComposition } from "./composition-preview";
import type { CompositionBuild, CompositionReadModel } from "./composition-model";
import { compositionSchemaSupported } from "./composition-model";
import type { ApplicationError } from "./errors";
import type { LearnerStore, Stored } from "./store";

export async function compositionProjection(
  store: LearnerStore,
  snapshot: CatalogSnapshot,
  day: DayKey,
  settings: Stored<Settings> | undefined,
  stats: Stored<LearnerStats> | undefined,
  portion: Stored<Portion> | undefined,
  tally: Stored<DayTally> | undefined,
  now: number,
): Promise<Result<CompositionReadModel, ApplicationError>> {
  const [source, model] = await Promise.all([
    store.compositionSource(),
    store.compositionReadModel(day),
  ]);
  if (source !== undefined && !compositionSchemaSupported(source.value))
    return err({ code: "ERR_READ_MODEL_NOT_READY" });
  const identity = {
    day,
    epoch: source?.value.epoch ?? 0,
    catalogVersion: snapshot.version,
    settingsVersion: settings?.version ?? null,
    statsVersion: stats?.version ?? null,
    portionVersion: portion?.version ?? null,
    tallyVersion: tally?.version ?? null,
  };
  if (stats !== undefined && stats.value.streak?.schema !== 1)
    return err({ code: "ERR_READ_MODEL_NOT_READY" });
  if (
    model?.value.schema === 1 &&
    (model.value.expiresAt === undefined || model.value.expiresAt * 1_000 > now) &&
    sameCompositionIdentity(model.value, identity)
  )
    return ok(model.value);
  if (source === undefined && stats === undefined && settings === undefined) {
    const empty: CompositionBuild = {
      ...identity,
      generation: "empty",
      schema: 1,
      phase: "ranks",
      cursor: null,
      known: "0".repeat(snapshot.shown.size),
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
    };
    return ok(
      publishComposition(empty, snapshot, undefined, EMPTY_STATS, undefined, 0),
    );
  }
  return err({ code: "ERR_READ_MODEL_NOT_READY" });
}
