import {
  drillLimitsOf,
  pickNew,
  seededRandom,
  seedFor,
  TUNING,
  type LearnerStats,
  type Settings,
  type CardMeta,
  type Weaknesses,
} from "@instant-composition/domain";
import type { CatalogSnapshot } from "./catalog";
import { compositionWeaknesses } from "./composition-aggregate";
import type { CompositionBuild } from "./composition-model";

export interface CompositionQueue {
  readonly weak: Weaknesses;
  readonly weakConcepts: readonly string[];
  readonly wantedNew: number;
  readonly reviewCount: number;
  readonly queued: number;
  readonly size: number;
  readonly available: number;
  readonly newPrefix: readonly CardMeta[];
  readonly reviewsInDeck: number;
  readonly topUpCount: number;
  readonly freshConcepts: ReadonlySet<string>;
}

export function compositionQueue(
  build: CompositionBuild,
  snapshot: CatalogSnapshot,
  settings: Settings | undefined,
  stats: LearnerStats,
  portionTarget: number | undefined,
  roundsStarted: number,
): CompositionQueue {
  const weak = compositionWeaknesses(build, snapshot);
  const weakConcepts = weak.grammar.map(({ concept }) => concept);
  const { newPerDay, reviewsPerDay } = drillLimitsOf(settings);
  const reviewQuota =
    reviewsPerDay === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, reviewsPerDay - (build.answered - build.newAnswered));
  const reviewCount = Math.min(build.due, reviewQuota);
  const wantedNew = Math.max(
    0,
    Math.min(newPerDay - build.newAnswered, reviewQuota - reviewCount),
  );
  const level = stats.level?.level ?? 1;
  const fresh = [...snapshot.shown.values()].filter(
    (card, at) =>
      build.known[at] !== "1" &&
      (settings?.topics ?? []).includes(card.topic) &&
      card.level >= level - 1 &&
      card.level <= level + TUNING.mix.probeStep,
  );
  const newCount = Math.min(fresh.length, wantedNew);
  const queued = reviewCount + newCount;
  const size =
    portionTarget ??
    (queued >= TUNING.minDeckSize
      ? queued
      : Math.min(TUNING.minDeckSize, queued + build.notDue));
  const available = queued + build.notDue;
  const picks = pickNew(
    fresh,
    newCount,
    { level, focus: settings?.focus ?? [], weakConcepts },
    seededRandom(seedFor(build.day, "today", roundsStarted)),
  );
  const newPrefix = picks.cards.filter(
    (_, at) => Math.floor(((at + 1) * reviewCount) / newCount) + at < size,
  );
  const reviewsInDeck = Math.min(size, queued) - newPrefix.length;
  const topUpCount = Math.max(0, Math.min(build.notDue, size - queued));
  const freshConcepts = new Set(newPrefix.flatMap((card) => card.concepts));
  return {
    weak,
    weakConcepts,
    wantedNew,
    reviewCount,
    queued,
    size,
    available,
    newPrefix,
    reviewsInDeck,
    topUpCount,
    freshConcepts,
  };
}
