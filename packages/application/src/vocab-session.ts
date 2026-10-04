import {
  DEFAULT_SETTINGS,
  err,
  withDefaults,
  ok,
  type Result,
  type VocabSession,
} from "@instant-composition/domain";

import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { projectedVocabPlan } from "./vocab-read-plan";
import { committed, storeFor, todayOf, type ApplicationDeps } from "./execute";
import { dealProjectedVocab } from "./vocab-deal-projection";
import { loadVocabSubset, sessionViewOf } from "./vocab-load";
import type { VocabCategory } from "./vocab-item";
import type { VocabHub, VocabSessionView } from "./vocab-views";

/** A start, as the client sends it: the session id is the client's. */
export interface StartVocabSessionCommand {
  readonly sessionId: string;
  readonly kind: VocabSession["kind"];
  /** Restricts the deal to one category; absent, every category deals. */
  readonly category?: VocabCategory;
}

/**
 * The hub: today's reviews and new cards with the minutes they take, each
 * category's share of them, the weak cards and tomorrow's reviews. Nothing is
 * written, so a read on another day deals from that day's queue.
 */
export async function vocabHub(
  deps: ApplicationDeps,
  context: RequestContext,
): Promise<Result<VocabHub, ApplicationError>> {
  const bound = storeFor(deps, context, "vocab");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  const snapshot = await deps.catalog.snapshot();
  if (!snapshot.ok) return snapshot;
  const [source, model, settings, stats] = await Promise.all([
    store.readModelSource(),
    store.vocabReadModel(todayOf(context)),
    store.settings(),
    store.stats(),
  ]);
  if (stats !== undefined && stats.value.streak?.schema !== 1)
    return err({ code: "ERR_READ_MODEL_NOT_READY" });
  if (
    model?.value.schema !== 1 ||
    (model.value.expiresAt !== undefined &&
      model.value.expiresAt * 1_000 <= context.now) ||
    model.value.status !== "ready" ||
    model.value.catalog !== snapshot.value.version ||
    model.value.sourceVersion !== (source?.version ?? 0)
  ) {
    return err({ code: "ERR_READ_MODEL_NOT_READY" });
  }
  const plan = await projectedVocabPlan(
    store,
    model.value,
    snapshot.value,
    withDefaults(settings?.value ?? DEFAULT_SETTINGS),
    stats?.value.level?.level ?? 1,
  );
  const [unchanged, current, currentSettings, currentStats] = await Promise.all([
    store.readModelSource(),
    store.vocabReadModel(model.value.day),
    store.settings(),
    store.stats(),
  ]);
  if (
    (unchanged?.version ?? 0) !== (source?.version ?? 0) ||
    current?.version !== model.version ||
    currentSettings?.version !== settings?.version ||
    currentStats?.version !== stats?.version
  )
    return err({ code: "ERR_CONFLICT" });
  return ok(plan.hub);
}

/**
 * Deals a session of the command's kind for today and keeps it, or answers
 * the session the id already names, so a retried start opens one session. A
 * session with nothing to deal is kept too, and answers no card.
 */
export async function startVocabSession(
  deps: ApplicationDeps,
  context: RequestContext,
  command: StartVocabSessionCommand,
): Promise<Result<VocabSessionView, ApplicationError>> {
  const bound = storeFor(deps, context, "startVocabSession");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  return committed(store, async () => {
    const existing = await store.vocabSession(command.sessionId);
    if (existing !== undefined) {
      const loaded = await loadVocabSubset(
        store,
        deps.catalog,
        context,
        existing.value.deck,
        existing.value.day,
      );
      return loaded.ok
        ? ok({ value: sessionViewOf(existing.value, loaded.value), writes: [] })
        : loaded;
    }
    const snapshot = await deps.catalog.snapshot();
    if (!snapshot.ok) return snapshot;
    const [source, model, settings, stats] = await Promise.all([
      store.readModelSource(),
      store.vocabReadModel(todayOf(context)),
      store.settings(),
      store.stats(),
    ]);
    if (stats !== undefined && stats.value.streak?.schema !== 1)
      return err({ code: "ERR_READ_MODEL_NOT_READY" });
    if (
      model?.value.schema !== 1 ||
      (model.value.expiresAt !== undefined &&
        model.value.expiresAt * 1_000 <= context.now) ||
      model.value.status !== "ready" ||
      model.value.catalog !== snapshot.value.version ||
      model.value.sourceVersion !== (source?.version ?? 0)
    )
      return err({ code: "ERR_READ_MODEL_NOT_READY" });
    const category = command.category ?? null;
    const session: VocabSession = {
      id: command.sessionId,
      kind: command.kind,
      category,
      day: model.value.day,
      deck: (
        await dealProjectedVocab(
          store,
          model.value,
          snapshot.value,
          withDefaults(settings?.value ?? DEFAULT_SETTINGS),
          stats?.value.level?.level ?? 1,
          command.kind,
          category,
        )
      ).map((card) => card.cardId),
      startedAt: context.now,
      finishedAt: null,
      tomorrow: null,
    };
    const loaded = await loadVocabSubset(
      store,
      deps.catalog,
      context,
      session.deck,
      session.day,
    );
    if (!loaded.ok) return loaded;
    return ok({
      value: sessionViewOf(session, loaded.value),
      writes: [[{ type: "vocabSession", value: session }, undefined]],
      expect: [
        { key: { type: "readModelSource" }, version: source?.version ?? null },
        {
          key: { type: "vocabReadModel", day: model.value.day },
          version: model.version,
        },
        { key: { type: "settings" }, version: settings?.version ?? null },
        { key: { type: "stats" }, version: stats?.version ?? null },
      ],
    });
  });
}
