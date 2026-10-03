import {
  DEFAULT_SETTINGS,
  EMPTY_STATS,
  TUNING,
  VOCAB_TUNING,
  err,
  ok,
  type Result,
} from "@instant-composition/domain";

import { snapshotOrEmpty, toeicOf, type CatalogSnapshot } from "./catalog";
import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { storeFor, type ApplicationDeps } from "./execute";
import { itemValues } from "./practice";
import { levelViewOf, shownSettingsOf, summaryOf } from "./present";
import { payloadOf } from "./round-payload";
import type { History, SettingsPageView } from "./query-views";
import type { LearnerStore } from "./store";
import type { RoundPayload, RoundSummary } from "./views";

/** The summary `roundId` kept when it finished, or `undefined` for a round not finished. */
async function keptSummary(
  store: LearnerStore,
  roundId: string,
  snapshot: CatalogSnapshot,
): Promise<RoundSummary | undefined> {
  const [round, reviews] = await Promise.all([
    store.round(roundId),
    store.reviewsOf(roundId),
  ]);
  const outcome = round?.value.outcome ?? null;
  return round === undefined || outcome === null
    ? undefined
    : summaryOf(round.value, outcome, reviews, snapshot);
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

/**
 * The round `roundId` as it is stored, with the answers it already holds —
 * open, finished or abandoned, on whatever day it was started — so a client
 * can resume it or reconcile its queue. Nothing is written: unlike a start, it
 * never refits the deck nor abandons the round. A round the learner does not
 * have is not found, another learner's included, since the store is their own.
 */
export async function roundPayload(
  deps: ApplicationDeps,
  context: RequestContext,
  roundId: string,
): Promise<Result<RoundPayload, ApplicationError>> {
  const bound = storeFor(deps, context, "round");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  const round = await store.round(roundId);
  if (round === undefined) {
    return err({ code: "ERR_ROUND_NOT_FOUND" });
  }
  const { portionDay } = round.value;
  const [snapshot, reviews, portion, items] = await Promise.all([
    deps.catalog.snapshot(),
    store.reviewsOf(roundId),
    portionDay === null ? undefined : store.portion(portionDay),
    store.items(),
  ]);
  // An empty snapshot would drop every card, which a client would read as all edited.
  return snapshot.ok
    ? ok(
        payloadOf(
          round.value,
          reviews,
          portion?.value,
          snapshot.value,
          itemValues(items),
        ),
      )
    : snapshot;
}

/**
 * The topics and subtopics a learner may choose: those holding at least one
 * shown card. One with none would only lead to a round with no cards to deal.
 */
function offeredTopics(snapshot: CatalogSnapshot): SettingsPageView["topics"] {
  const cells = new Set(
    [...snapshot.shown.values()].map((card) => `${card.topic}/${card.subtopic}`),
  );
  return snapshot.topics.flatMap((topic) => {
    const subtopics = topic.subtopics
      .filter(({ id }) => cells.has(`${topic.id}/${id}`))
      .map(({ id, name }) => ({ id, name }));
    return subtopics.length === 0
      ? []
      : [{ id: topic.id, name: topic.name, subtopics }];
  });
}

/** The settings as saved (the defaults before any), the topics with cards and the difficulty. */
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
  const totals = stats?.value ?? EMPTY_STATS;
  const level = totals.level;
  return ok({
    settings: shownSettingsOf(settings?.value ?? DEFAULT_SETTINGS),
    options: {
      dailySizes: TUNING.dailySizes,
      newPerDay: TUNING.newPerDay,
      reviewsPerDay: TUNING.reviewsPerDay,
      vocabNewPerDay: VOCAB_TUNING.newPerDay,
      vocabReviewsPerDay: VOCAB_TUNING.reviewsPerDay,
      limitSeconds: TUNING.limitSeconds,
      maxFocus: TUNING.maxFocus,
    },
    topics: offeredTopics(snapshot),
    toeic: level === null ? null : toeicOf(snapshot, level.level),
    difficulty: levelViewOf(totals, snapshot),
    levels: [...snapshot.levels]
      .sort(([a], [b]) => a - b)
      .map(([step, info]) => ({ level: step, toeic: info.toeic })),
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
