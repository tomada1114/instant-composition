import {
  DEFAULT_SETTINGS,
  err,
  ok,
  withDefaults,
  type Result,
  type VocabPagedSession,
} from "@instant-composition/domain";
import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import type { ApplicationDeps } from "./execute";
import { todayOf } from "./execute";
import type { LearnerStore, Commit } from "./store";
import { dealProjectedVocab } from "./vocab-deal-projection";
import { freshVocabCandidates, projectedVocabPlan } from "./vocab-read-plan";
import { requestVocabDay } from "./requested-vocab-day";
import type { StartVocabSessionCommand } from "./vocab-session";

/** Only an explicit start/preparation command selects a source; reads never rebuild it. */
export async function planPagedVocab(
  store: LearnerStore,
  deps: ApplicationDeps,
  context: RequestContext,
  command: StartVocabSessionCommand,
  previous?: VocabPagedSession,
): Promise<
  Result<
    { readonly session: VocabPagedSession; readonly expect: Commit["expect"] },
    ApplicationError
  >
> {
  const snapshot = await deps.catalog.snapshot();
  if (!snapshot.ok) return snapshot;
  const day = previous?.day ?? todayOf(context);
  const [source, model, settings, stats] = await Promise.all([
    store.readModelSource(),
    store.vocabReadModel(day),
    store.settings(),
    store.stats(),
  ]);
  if (stats !== undefined && stats.value.streak?.schema !== 1)
    return err({ code: "ERR_READ_MODEL_NOT_READY" });
  if (
    model?.value.status !== "ready" ||
    model.value.catalog !== snapshot.value.version ||
    model.value.sourceVersion !== (source?.version ?? 0) ||
    (model.value.expiresAt !== undefined && model.value.expiresAt * 1000 <= context.now)
  ) {
    if (previous !== undefined) await requestVocabDay(store, day);
    return err({ code: "ERR_READ_MODEL_NOT_READY" });
  }
  const limits = withDefaults(settings?.value ?? DEFAULT_SETTINGS);
  const level = stats?.value.level?.level ?? 1;
  const category = command.category ?? null;
  let dueCount = 0;
  let fresh: string[];
  let total: number;
  if (command.kind === "today" && limits.vocabReviewsPerDay === null) {
    const [plan, candidates] = await Promise.all([
      projectedVocabPlan(store, model.value, snapshot.value, limits, level),
      freshVocabCandidates(store, model.value, snapshot.value, level),
    ]);
    dueCount = model.value.counts.reduce((count, row) => count + row.due, 0);
    const selected = candidates.slice(0, plan.newCount);
    fresh = selected.map((card) => card.cardId);
    total =
      model.value.counts
        .filter((row) => category === null || row.category === category)
        .reduce((count, row) => count + row.due, 0) +
      selected.filter((row) => category === null || row.cardCategory === category)
        .length;
  } else {
    fresh = (
      await dealProjectedVocab(
        store,
        model.value,
        snapshot.value,
        limits,
        level,
        command.kind,
        category,
      )
    ).map((card) => card.cardId);
    total = fresh.length;
  }
  const generation = (previous?.generation ?? 0) + 1;
  if (
    ![generation, dueCount, total, dueCount + fresh.length].every(Number.isSafeInteger)
  )
    return err({ code: "ERR_CONFLICT" });
  return ok({
    session: {
      id: command.sessionId,
      kind: command.kind,
      category,
      day,
      startedAt: previous?.startedAt ?? context.now,
      finishedAt: null,
      tomorrow: null,
      status: total === 0 ? "ready" : "building",
      generation,
      catalog: snapshot.value.version,
      sourceVersion: source?.version ?? 0,
      modelVersion: model.version,
      settingsVersion: settings?.version ?? null,
      statsVersion: stats?.version ?? null,
      candidateGeneration: model.value.generation,
      dueCount,
      fresh: total === 0 ? [] : fresh,
      dueCursor: null,
      dueRead: 0,
      freshRead: 0,
      pages: 0,
      total,
      answered: 0,
      introduced: 0,
      againCount: 0,
      again: [],
    },
    expect: [
      { key: { type: "readModelSource" }, version: source?.version ?? null },
      { key: { type: "vocabReadModel", day }, version: model.version },
      { key: { type: "settings" }, version: settings?.version ?? null },
      { key: { type: "stats" }, version: stats?.version ?? null },
    ],
  });
}
