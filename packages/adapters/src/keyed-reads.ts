import type {
  Entry,
  Key,
  LearnerStore,
  Stored,
} from "@instant-composition/application";

import type { ValueOf } from "./storage-values";

type Get = <T extends Entry["type"]>(
  key: Extract<Key, { readonly type: T }>,
) => Promise<Stored<ValueOf<T>> | undefined>;

type Keyed = Pick<
  LearnerStore,
  "itemsByIds" | "reviewsByIds" | "vocabItemsByIds" | "vocabReviewsByIds" | "cardsByIds"
>;

/** Point reads deduplicate requested ids and never enumerate a partition. */
export function keyedReads(get: Get): Keyed {
  async function many<T extends Entry["type"]>(
    ids: readonly string[],
    key: (id: string) => Extract<Key, { readonly type: T }>,
  ): Promise<ReadonlyMap<string, Stored<ValueOf<T>>>> {
    const found = await Promise.all(
      [...new Set(ids)].map(async (id) => {
        const stored = await get<T>(key(id));
        return stored === undefined ? [] : [[id, stored] as const];
      }),
    );
    return new Map(found.flat());
  }
  return {
    itemsByIds: (ids) =>
      many(ids, (id) => ({ type: "item", item: { kind: "composition", id } })),
    reviewsByIds: (sessionId, ids) =>
      many(ids, (id) => ({ type: "review", sessionId, id })),
    vocabItemsByIds: (ids) => many(ids, (cardId) => ({ type: "vocabItem", cardId })),
    vocabReviewsByIds: (sessionId, ids) =>
      many(ids, (id) => ({ type: "vocabReview", sessionId, id })),
    cardsByIds: (ids) => many(ids, (id) => ({ type: "card", id })),
  };
}
