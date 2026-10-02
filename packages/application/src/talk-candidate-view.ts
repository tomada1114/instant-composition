import {
  normalizeHeadword,
  type TalkCards,
  type VocabProgress,
} from "@instant-composition/domain";

import type { CatalogSnapshot } from "./catalog";
import type { LearnerStore } from "./store";
import type { CardCandidates } from "./talk-views";
import { knownHeadwords, shownCards, type ShownCard } from "./vocab-shown";

/** The learner's vocabulary as a candidate is matched against it. */
export interface Vocabulary {
  readonly cards: ReadonlyMap<string, ShownCard>;
  readonly progress: ReadonlyMap<string, VocabProgress>;
}

export async function vocabularyOf(
  store: LearnerStore,
  snapshot: CatalogSnapshot,
): Promise<Vocabulary> {
  const [items, personal] = await Promise.all([store.vocabItems(), store.cards()]);
  return {
    cards: shownCards(snapshot, personal),
    progress: new Map([...items].map(([id, stored]) => [id, stored.value])),
  };
}

/**
 * The candidates as the learner sees them: one matched by its headword, or
 * added, is answered as its card, with whether that card is in learning.
 */
export function viewOf(offered: TalkCards, vocabulary: Vocabulary): CardCandidates {
  const known = knownHeadwords(vocabulary.cards);
  return {
    candidates: offered.candidates.map((candidate, index) => {
      const added = offered.added.find((entry) => entry.index === index);
      const cardId =
        added?.cardId ?? known.get(normalizeHeadword(candidate.headword)) ?? null;
      const card = cardId === null ? undefined : vocabulary.cards.get(cardId);
      const { category, headword, definition, example, example2, meaning } =
        card ?? candidate;
      return {
        ...{ index, turn: candidate.turn, cardId, catalog: card?.personal === false },
        ...{ category, headword, definition, example, example2, meaning },
        inLearning:
          cardId !== null && (vocabulary.progress.get(cardId)?.state ?? null) !== null,
        added: added !== undefined,
      };
    }),
  };
}
