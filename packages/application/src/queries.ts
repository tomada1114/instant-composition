import { DEFAULT_SETTINGS, err, ok, type Result } from "@instant-composition/domain";

import { snapshotOrEmpty, toeicOf, type CatalogSnapshot } from "./catalog";
import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { storeFor, todayOf, type ApplicationDeps } from "./execute";
import { summaryOf } from "./present";
import type { History, SettingsPageView } from "./query-views";
import type { LearnerStore } from "./store";
import type { RoundSummary } from "./views";

/** The summary `roundId` kept when it finished, or `undefined` for a round not finished. */
async function keptSummary(
  store: LearnerStore,
  roundId: string,
  snapshot: CatalogSnapshot,
): Promise<RoundSummary | undefined> {
  const round = await store.round(roundId);
  const outcome = round?.value.outcome ?? null;
  return round === undefined || outcome === null
    ? undefined
    : summaryOf(round.value, outcome, snapshot);
}

/** The kept summary of today's last finished round, for reading back. */
export async function recap(
  deps: ApplicationDeps,
  context: RequestContext,
): Promise<Result<RoundSummary | undefined, ApplicationError>> {
  const bound = storeFor(deps, context, "recap");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  const today = todayOf(context);
  const [{ snapshot }, tallies] = await Promise.all([
    snapshotOrEmpty(deps.catalog),
    store.days([today]),
  ]);
  const last = tallies.get(today)?.value.lastFinishedRound ?? null;
  return ok(last === null ? undefined : await keptSummary(store, last, snapshot));
}

/**
 * The summary the round `roundId` kept when it finished, whatever day it was.
 * A round the learner does not have, or one not finished, is not found: the
 * store is the learner's own, so another learner's round is never reached.
 */
export async function roundSummary(
  deps: ApplicationDeps,
  context: RequestContext,
  roundId: string,
): Promise<Result<RoundSummary, ApplicationError>> {
  const bound = storeFor(deps, context, "recap");
  if (!bound.ok) {
    return bound;
  }
  const { snapshot } = await snapshotOrEmpty(deps.catalog);
  const summary = await keptSummary(bound.value, roundId, snapshot);
  return summary === undefined ? err({ code: "ERR_ROUND_NOT_FOUND" }) : ok(summary);
}

/** The settings as saved (the defaults before any), the taxonomy and the difficulty. */
export async function settingsPage(
  deps: ApplicationDeps,
  context: RequestContext,
): Promise<Result<SettingsPageView, ApplicationError>> {
  const bound = storeFor(deps, context, "settings");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  const [{ snapshot }, settings, stats] = await Promise.all([
    snapshotOrEmpty(deps.catalog),
    store.settings(),
    store.stats(),
  ]);
  const level = stats?.value.level ?? null;
  return ok({
    settings: settings?.value ?? DEFAULT_SETTINGS,
    topics: snapshot.topics.map((topic) => ({
      id: topic.id,
      name: topic.name,
      subtopics: topic.subtopics.map(({ id, name }) => ({ id, name })),
    })),
    toeic: level === null ? null : toeicOf(snapshot, level.level),
  });
}

/** What the card-planning tooling reads: the cards seen, the choices and the level. */
export async function history(
  deps: ApplicationDeps,
  context: RequestContext,
): Promise<Result<History, ApplicationError>> {
  const bound = storeFor(deps, context, "history");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  const [settings, stats, items] = await Promise.all([
    store.settings(),
    store.stats(),
    store.items(),
  ]);
  return ok({
    seenIds: [...items.keys()].sort(),
    topics: settings?.value.topics ?? [],
    focusSubtopics: (settings?.value.focus ?? []).map(
      (ref) => `${ref.topic}/${ref.subtopic}`,
    ),
    estimatedLevel: stats?.value.level?.level ?? 1,
  });
}
