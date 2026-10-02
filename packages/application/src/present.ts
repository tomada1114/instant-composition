import {
  levelModeOf,
  nearestMilestone,
  ringProgress,
  type LearnerStats,
  type ReviewEntry,
  type Round,
  type RoundOutcome,
  type Settings,
  withDefaults,
} from "@instant-composition/domain";

import { toeicOf, type CatalogSnapshot } from "./catalog";
import { answeredOf } from "./round-payload";
import type { LevelView, ReachView, RoundSummary, ShownSettings } from "./views";

/** The level and its mode, named by the TOEIC reference the catalog gives it. */
export function levelViewOf(stats: LearnerStats, snapshot: CatalogSnapshot): LevelView {
  const level = stats.level?.level ?? null;
  return {
    mode: levelModeOf(stats),
    level,
    toeic: level === null ? null : toeicOf(snapshot, level),
  };
}

/** The settings as a client reads them, picked field by field for the reason `payloadOf` gives. */
export function shownSettingsOf(settings: Settings): ShownSettings {
  const shown = withDefaults(settings);
  const { topics, focus, dailySize, sound, limitSeconds, gradeKeys } = shown;
  const { newPerDay, reviewsPerDay, vocabNewPerDay, vocabReviewsPerDay } = shown;
  return {
    ...{ topics, focus, dailySize, sound, limitSeconds },
    gradeKeys: { ok: gradeKeys.ok, ng: gradeKeys.ng, hard: gradeKeys.hard },
    ...{ newPerDay, reviewsPerDay, vocabNewPerDay, vocabReviewsPerDay },
  };
}

/** Mastered cards per chosen topic, with each ring and the nearest milestone. */
export function reachViewOf(
  reach: RoundOutcome["reach"],
  snapshot: CatalogSnapshot,
  pending: number | undefined,
): ReachView {
  const name = (topic: string): string =>
    snapshot.topics.find((info) => info.id === topic)?.name ?? topic;
  const nearest = nearestMilestone(
    new Map(reach.map((entry) => [entry.topic, entry.count])),
    reach.map((entry) => entry.topic),
  );
  return {
    topics: reach.map((entry) => ({
      id: entry.topic,
      name: name(entry.topic),
      count: entry.count,
      added: entry.added,
      ring: ringProgress(entry.count),
    })),
    nearest:
      nearest === undefined
        ? null
        : { name: name(nearest.topic), remaining: nearest.remaining },
    ...(pending === undefined ? {} : { pending }),
  };
}

/**
 * A finished round's end screen: its kept outcome, named from the catalog, and
 * its answers read from the log.
 */
export function summaryOf(
  round: Round,
  outcome: RoundOutcome,
  reviews: readonly ReviewEntry[],
  snapshot: CatalogSnapshot,
): RoundSummary {
  return {
    roundId: round.id,
    kind: round.kind,
    day: round.day,
    answered: answeredOf(reviews),
    yesterday: round.kind === "yesterday",
    placement:
      outcome.placement === null
        ? null
        : { ...outcome.placement, toeic: toeicOf(snapshot, outcome.placement.level) },
    difficulty:
      outcome.difficulty === null
        ? null
        : {
            change: outcome.difficulty.change,
            toeic: toeicOf(snapshot, outcome.difficulty.level),
          },
    growth: outcome.growth,
    review: outcome.review,
    streak: outcome.streak,
    week: outcome.week,
    filled: outcome.filled,
    reach: reachViewOf(outcome.reach, snapshot, outcome.pending),
    titles: outcome.titles,
    topicNames: Object.fromEntries(
      snapshot.topics.map((topic) => [topic.id, topic.name]),
    ),
    points: outcome.points,
    totals: outcome.totals,
    portionCompleted: outcome.portionCompleted,
    todayOpen: outcome.todayOpen,
    continueToday: outcome.continueToday,
  };
}
