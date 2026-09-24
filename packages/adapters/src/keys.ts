import {
  keyOf,
  type Commit,
  type Key,
  type LearnerId,
} from "@instant-composition/application";

/**
 * The attribute names of the learner table's primary key: one partition per
 * learner, one sort key per entry, as ADR-0006 lays the table out.
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
 * Where an entry sits inside its learner's partition. ADR-0006's layout, plus
 * `DAY#<day>` for the day tallies it does not list. A review sorts under its
 * round, so a round's reviews are one prefix and no round id can match it.
 */
export function sortKeyOf(key: Key): string {
  switch (key.type) {
    case "settings":
      return "SETTINGS";
    case "stats":
      return "STATS";
    case "round":
      return `ROUND#${part(key.id)}`;
    case "review":
      return `${reviewsPrefix(key.sessionId)}${part(key.id)}`;
    case "portion":
      return `PORTION#${part(key.day)}`;
    case "day":
      return `DAY#${part(key.day)}`;
    case "item":
      return `ITEM#${part(key.item.kind)}#${part(key.item.id)}`;
  }
}

/** The sort key prefix every review of `sessionId` shares, and nothing else does. */
export function reviewsPrefix(sessionId: string): string {
  return `ROUND#${part(sessionId)}#ANSWER#`;
}

/**
 * Refuses a commit no store could apply as one transaction. These are
 * programming errors rather than conflicts, so they throw instead of
 * returning `ERR_CONFLICT`: nothing a retry could fix.
 */
export function checkShape(commit: Commit): void {
  const keys = [
    ...commit.puts.map((entry) => sortKeyOf(keyOf(entry))),
    ...commit.updates.map(({ entry }) => sortKeyOf(keyOf(entry))),
    ...commit.expect.map(({ key }) => sortKeyOf(key)),
  ];
  if (keys.length > MAX_COMMIT_ITEMS) {
    throw new RangeError(`A commit names at most ${String(MAX_COMMIT_ITEMS)} items.`);
  }
  if (new Set(keys).size !== keys.length) {
    throw new RangeError("A commit names each key once.");
  }
  if (commit.updates.some(({ entry }) => entry.type === "review")) {
    throw new RangeError("The review log is append-only.");
  }
}
