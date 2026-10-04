import {
  READ_MODEL_PAGE_SIZE,
  vocabCandidateId,
  type CandidatePageRequest,
  type Entry,
  type Key,
  type LearnerStore,
  type Stored,
} from "@instant-composition/application";

import {
  candidatePrefix,
  candidateSortKey,
  checkCandidatePage,
  pageCursor,
} from "./read-model-keys";

import type { ValueOf } from "./dynamodb-rows";
import { compositionCandidateReads } from "./composition-candidate-reads";
export type GetEntry = <T extends Entry["type"]>(
  key: Key & { readonly type: T },
) => Promise<Stored<ValueOf<T>> | undefined>;
export type EntryPage = <T extends Entry["type"]>(
  type: T,
  prefix: string,
  limit: number,
  cursor: string | null,
) => Promise<{
  readonly rows: readonly Stored<ValueOf<T>>[];
  readonly cursor: string | null;
}>;
type ReadPorts = Pick<
  LearnerStore,
  | "readModelSource"
  | "vocabReadModel"
  | "vocabReadModelRequest"
  | "vocabReadModelRequests"
  | "vocabCandidates"
  | "vocabCandidatesByKeys"
  | "personalCardPage"
  | "vocabItemsByIds"
  | "itemsByIds"
  | "cardsByIds"
  | "vocabReviewsByIds"
  | "reviewsByIds"
  | "compositionCandidates"
  | "compositionCandidatesByKeys"
>;

/** The same bounded port surface over a store's strongly consistent point/page readers. */
export function readModelReads(
  get: GetEntry,
  page: EntryPage,
  partition: string,
): ReadPorts {
  async function points<T extends Entry["type"]>(
    ids: readonly string[],
    key: (id: string) => Key & { readonly type: T },
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
    ...compositionCandidateReads(get, page),
    readModelSource: () => get({ type: "readModelSource" }),
    vocabReadModelRequest: (day) => get({ type: "vocabReadModelRequest", day }),
    vocabReadModelRequests: (cursor) =>
      page(
        "vocabReadModelRequest",
        "READMODEL#VOCAB_REQUEST#",
        READ_MODEL_PAGE_SIZE,
        cursor,
      ),
    vocabReadModel: (day) => get({ type: "vocabReadModel", day }),
    async vocabCandidatesByKeys(candidates) {
      const unique = new Map(
        candidates.map((candidate) => [vocabCandidateId(candidate), candidate]),
      );
      const found = await Promise.all(
        [...unique].map(async ([id, candidate]) => {
          const stored = await get({ type: "vocabCandidate", candidate });
          return stored === undefined ? [] : [[id, stored] as const];
        }),
      );
      return new Map(found.flat());
    },
    async vocabCandidates(request: CandidatePageRequest) {
      checkCandidatePage(request);
      const prefix = candidatePrefix(request);
      const cursor =
        request.cursor === null && request.after !== undefined
          ? pageCursor(
              partition,
              prefix,
              candidateSortKey({
                ...request,
                ...request.after,
                schema: 1,
                kind: "review",
                cardCategory: request.category ?? "word",
                cardLevel: 1,
              }),
            )
          : request.cursor;
      return page("vocabCandidate", prefix, request.limit, cursor);
    },
    personalCardPage: (cursor) => page("card", "CARD#", READ_MODEL_PAGE_SIZE, cursor),
    vocabItemsByIds: (ids) => points(ids, (cardId) => ({ type: "vocabItem", cardId })),
    itemsByIds: (ids) =>
      points(ids, (id) => ({ type: "item", item: { kind: "composition", id } })),
    vocabReviewsByIds: (sessionId, ids) =>
      points(ids, (id) => ({ type: "vocabReview", sessionId, id })),
    reviewsByIds: (sessionId, ids) =>
      points(ids, (id) => ({ type: "review", sessionId, id })),
    cardsByIds: (ids) => points(ids, (id) => ({ type: "card", id })),
  };
}
