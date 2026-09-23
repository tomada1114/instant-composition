import { DEFAULT_SETTINGS, ok, type Result } from "@instant-composition/domain";

import { snapshotOrEmpty, toeicOf } from "./catalog";
import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { storeFor, todayOf, type ApplicationDeps } from "./execute";
import { summaryOf } from "./present";
import type { History, SettingsPageView } from "./query-views";
import type { RoundSummary } from "./views";

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
  const round = last === null ? undefined : await store.round(last);
  const outcome = round?.value.outcome ?? null;
  return ok(
    round === undefined || outcome === null
      ? undefined
      : summaryOf(round.value, outcome, snapshot),
  );
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
      ja: topic.ja,
      subtopics: topic.subtopics.map(({ id, ja }) => ({ id, ja })),
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
