import { normalizeHeadword, type PersonalCard } from "@instant-composition/domain";

import type { CatalogSnapshot } from "./catalog";
import type { Stored } from "./store";
import type { VocabItem } from "./vocab-item";

/** A card the learner's vocabulary deals: the catalog's, or one of their own. */
export interface ShownCard extends VocabItem {
  /** Made from a talk's candidate, and the learner's to delete. */
  readonly personal: boolean;
}

/**
 * Every card the learner's vocabulary deals, by id: the catalog's in its
 * order, then their personal cards made for the snapshot's language pair, in
 * the order they were made.
 */
export function shownCards(
  snapshot: CatalogSnapshot,
  personal: ReadonlyMap<string, Stored<PersonalCard>>,
): Map<string, ShownCard> {
  const own = [...personal.values()]
    .map(({ value }) => value)
    .filter((card) => card.target === snapshot.target && card.l1 === snapshot.l1)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return new Map<string, ShownCard>([
    ...[...snapshot.vocab.values()].map((item): [string, ShownCard] => [
      item.id,
      { ...item, personal: false },
    ]),
    ...own.map((card): [string, ShownCard] => {
      const { id, target, category, level, headword, definition } = card;
      const { example, example2, meaning } = card;
      return [
        id,
        {
          ...{ id, target, category, level, headword, definition },
          ...{ example, example2, meaning, personal: true },
        },
      ];
    }),
  ]);
}

/**
 * The card each normalized headword is answered as: the first catalog card
 * holding it, else the learner's own card holding it.
 */
export function knownHeadwords(
  cards: ReadonlyMap<string, ShownCard>,
): Map<string, string> {
  const known = new Map<string, string>();
  const ordered = [...cards.values()].sort(
    (a, b) => Number(a.personal) - Number(b.personal),
  );
  for (const card of ordered) {
    const headword = normalizeHeadword(card.headword);
    if (!known.has(headword)) known.set(headword, card.id);
  }
  return known;
}
