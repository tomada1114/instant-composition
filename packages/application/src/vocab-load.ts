import {
  DEFAULT_SETTINGS,
  ok,
  previewGrades,
  withDefaults,
  type dealVocab,
  type DayKey,
  type PersonalCard,
  type Result,
  type VocabProgress,
  type VocabReview,
  type VocabSession,
} from "@instant-composition/domain";

import type { Catalog, CatalogSnapshot } from "./catalog";
import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { todayOf } from "./execute";
import type { LearnerStore, Stored } from "./store";
import { shownCards, type ShownCard } from "./vocab-shown";
import type { VocabCardView, VocabSessionView, VocabSummary } from "./vocab-views";

/** What every vocabulary deal reads, as the domain takes it. */
export type VocabState = Parameters<typeof dealVocab>[0];

/** What every vocabulary command and query reads first, taken once per attempt. */
export interface VocabLoad {
  readonly snapshot: CatalogSnapshot;
  /** The catalog's cards and the learner's own, by id. */
  readonly cards: ReadonlyMap<string, ShownCard>;
  readonly personal: ReadonlyMap<string, Stored<PersonalCard>>;
  readonly items: ReadonlyMap<string, Stored<VocabProgress>>;
  readonly state: VocabState;
}

/**
 * The catalog's vocabulary and the learner's own cards, the learner's limits
 * and level, and their progress on each card, as the state of `today` — the practice day of
 * `context.now` unless a session names its own.
 */
export async function loadVocab(
  store: LearnerStore,
  catalog: Catalog,
  context: RequestContext,
  today: DayKey = todayOf(context),
): Promise<Result<VocabLoad, ApplicationError>> {
  const snapshot = await catalog.snapshot();
  if (!snapshot.ok) {
    return snapshot;
  }
  const [settings, stats, items, personal] = await Promise.all([
    store.settings(),
    store.stats(),
    store.vocabItems(),
    store.cards(),
  ]);
  const limits = withDefaults(settings?.value ?? DEFAULT_SETTINGS);
  const cards = shownCards(snapshot.value, personal);
  return ok({
    snapshot: snapshot.value,
    cards,
    personal,
    items,
    state: {
      today,
      // Before a placement or a pick sets the drill's level, the band starts at the bottom.
      level: stats?.value.level?.level ?? 1,
      cards: [...cards.values()],
      progress: new Map([...items].map(([id, stored]) => [id, stored.value])),
      newPerDay: limits.vocabNewPerDay,
      reviewsPerDay: limits.vocabReviewsPerDay,
    },
  });
}

/** What a review keeps of each card the learner's vocabulary deals. */
export function vocabSnapshots(
  cards: ReadonlyMap<string, ShownCard>,
): Map<string, VocabReview["snapshot"]> {
  return new Map(
    [...cards.values()].map(({ id, headword, meaning, category, level }) => [
      id,
      { headword, meaning, category, level },
    ]),
  );
}

function cardViewOf(
  item: ShownCard,
  progress: VocabProgress | undefined,
  day: DayKey,
): VocabCardView {
  const state = progress?.state ?? null;
  const preview = previewGrades(state ?? undefined, day, item.id);
  const { id, category, level, definition, example, headword, meaning, example2 } =
    item;
  return {
    ...{ id, category, level, definition, example, headword, meaning, example2 },
    intervals: {
      again: preview.again.intervalDays,
      hard: preview.hard.intervalDays,
      good: preview.good.intervalDays,
    },
    isNew: state === null,
    personal: item.personal,
  };
}

/**
 * The session with its cards in the order dealt, each with the intervals its
 * first answer on the session's day would set. A card the catalog no longer
 * shows, or a personal card since deleted, is left out.
 */
export function sessionViewOf(
  session: VocabSession,
  load: VocabLoad,
): VocabSessionView {
  return {
    sessionId: session.id,
    kind: session.kind,
    category: session.category,
    day: session.day,
    cards: session.deck.flatMap((cardId) => {
      const item = load.cards.get(cardId);
      return item === undefined
        ? []
        : [cardViewOf(item, load.state.progress.get(cardId), session.day)];
    }),
  };
}

/**
 * The done screen's figures, from the session's own log: the cards it
 * answered, those it introduced, and the ones whose first answer in it was
 * graded again.
 */
export function summaryOf(
  session: VocabSession,
  reviews: readonly VocabReview[],
): VocabSummary {
  const firsts = reviews.filter(
    (review, index) =>
      reviews.findIndex((other) => other.cardId === review.cardId) === index,
  );
  return {
    sessionId: session.id,
    kind: session.kind,
    category: session.category,
    day: session.day,
    answered: firsts.length,
    new: firsts.filter((review) => review.before === null).length,
    again: firsts
      .filter((review) => review.grade === "again")
      .map(({ cardId, snapshot }) => ({
        cardId,
        headword: snapshot.headword,
        meaning: snapshot.meaning,
      })),
    tomorrow: session.tomorrow ?? 0,
  };
}
