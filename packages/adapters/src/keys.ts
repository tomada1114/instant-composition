import {
  keyOf,
  type Commit,
  type Key,
  type LearnerId,
} from "@instant-composition/application";
import { modelTaskSortKey } from "./storage-model-task";

import { candidateSortKey, READ_MODEL_SOURCE_KEY } from "./read-model-keys";
import { compositionCandidateSortKey } from "./composition-candidate-keys";

/**
 * The attribute names of the learner table's primary key: one partition per
 * learner, one sort key per entry.
 */
export const LEARNER_TABLE_KEY = { partition: "PK", sort: "SK" } as const;

/**
 * The most items one commit may name, puts, updates and expectations together:
 * DynamoDB's TransactWriteItems limit, held by every store so a command that
 * would outgrow it fails against the in-memory one first.
 */
export const MAX_COMMIT_ITEMS = 100;

/**
 * One id inside a key. `encodeURIComponent` escapes `#` and `%`, so no id can
 * reach across a separator and two different keys never share a string.
 */
function part(id: string): string {
  return encodeURIComponent(id);
}

export function partitionKeyOf(learner: LearnerId): string {
  return `LEARNER#${part(learner)}`;
}

/**
 * The identity mapping's partition: one per identity provider subject, outside
 * every learner's partition, so no learner-bound read can reach it.
 */
export function identityKeyOf(subject: string): string {
  return `IDENTITY#${part(subject)}`;
}

/**
 * The sort keys the identity context writes: the mapping, and the learner's
 * profile — the very item the learner-bound store reads and changes as its
 * `profile` entry, so registration and a later change share one row.
 */
export const IDENTITY_SORT_KEY = {
  mapping: "LEARNER",
  profile: sortKeyOf({ type: "profile" }),
} as const;

/** The prefix of every personal vocabulary card, and of nothing else. */
export const CARDS_PREFIX = "CARD#";

/**
 * Where an entry sits inside its learner's partition, plus
 * `DAY#<day>` for the day tallies it does not list. A review sorts under its
 * round, so a round's reviews are one prefix and no round id can match it; a
 * vocabulary answer sorts under its session the same way, under `VOCAB#`.
 */
export function sortKeyOf(key: Key): string {
  switch (key.type) {
    case "compositionCandidate":
      return compositionCandidateSortKey(key.candidate);
    case "profile":
      return "PROFILE";
    case "settings":
      return "SETTINGS";
    case "stats":
      return "STATS";
    case "readModelSource":
      return READ_MODEL_SOURCE_KEY;
    case "vocabReadModelRequest":
      return `READMODEL#VOCAB_REQUEST#${part(key.day)}`;
    case "vocabReadModel":
      return `READMODEL#VOCAB#${part(key.day)}#STATE`;
    case "vocabCandidate":
      return candidateSortKey(key.candidate);
    case "compositionSource":
      return "READMODEL#COMPOSITION#SOURCE";
    case "compositionReadModel":
      return `READMODEL#COMPOSITION#${part(key.day)}#STATE`;
    case "compositionBuild":
      return `READMODEL#COMPOSITION#${part(key.day)}#BUILD`;
    case "streakRun":
      return `STREAK#${part(key.start)}`;
    case "streakMigration":
      return "READMODEL#STREAK#MIGRATION";
    case "round":
      return `ROUND#${part(key.id)}`;
    case "review":
      return `${reviewsPrefix(key.sessionId)}${part(key.id)}`;
    case "portion":
      return `PORTION#${part(key.day)}`;
    case "day":
      return `DAY#${part(key.day)}`;
    case "item":
      return `${itemsPrefix(key.item.kind)}${part(key.item.id)}`;
    case "talk":
      return `TALK#${part(key.id)}`;
    case "modelTask":
      return modelTaskSortKey(key.task);
    case "vocabItem":
      return `${itemsPrefix("vocab")}${part(key.cardId)}`;
    case "vocabSession":
      return `VOCAB#${part(key.id)}`;
    case "vocabReview":
      return `${vocabReviewsPrefix(key.sessionId)}${part(key.id)}`;
    case "card":
      return `${CARDS_PREFIX}${part(key.id)}`;
  }
}

/** The sort key prefix every review of `sessionId` shares, and nothing else does. */
export function reviewsPrefix(sessionId: string): string {
  return `ROUND#${part(sessionId)}#ANSWER#`;
}

/**
 * The prefix of every vocabulary session's answers: under the session, kept
 * apart from the drill's rounds, so neither log's read reaches the other.
 */
export function vocabReviewsPrefix(sessionId: string): string {
  return `VOCAB#${part(sessionId)}#ANSWER#`;
}

/** The prefix of every item of one kind: the drill's `composition`, or `vocab`. */
export function itemsPrefix(kind: string): string {
  return `ITEM#${part(kind)}#`;
}

/**
 * Refuses a commit no store could apply as one transaction. These are
 * programming errors rather than conflicts, so they throw instead of
 * returning `ERR_CONFLICT`: nothing a retry could fix.
 */
export function checkShape(commit: Commit): void {
  if (
    commit.updates.some(
      ({ entry, modelClaim }) => modelClaim !== undefined && entry.type !== "modelTask",
    )
  ) {
    throw new RangeError("A claim token condition applies only to a model task.");
  }
  const deletes = commit.deletes ?? [];
  const keys = [
    ...commit.puts.map((entry) => sortKeyOf(keyOf(entry))),
    ...commit.updates.map(({ entry }) => sortKeyOf(keyOf(entry))),
    ...commit.expect.map(({ key }) => sortKeyOf(key)),
    ...deletes.map(({ key }) => sortKeyOf(key)),
  ];
  if (keys.length > MAX_COMMIT_ITEMS) {
    throw new RangeError(`A commit names at most ${String(MAX_COMMIT_ITEMS)} items.`);
  }
  if (new Set(keys).size !== keys.length) {
    throw new RangeError("A commit names each key once.");
  }
  const logged = (type: Key["type"]): boolean =>
    type === "review" || type === "vocabReview";
  if (
    commit.updates.some(({ entry }) => logged(entry.type)) ||
    deletes.some(({ key }) => logged(key.type))
  ) {
    throw new RangeError("The review log is append-only.");
  }
}
