import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import {
  keyOf,
  type Commit,
  type Entry,
  type Key,
} from "@instant-composition/application";

import { LEARNER_TABLE_KEY, sortKeyOf } from "./keys";

type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

/** An entry must not exist yet: the condition that turns a resent answer into a conflict. */
const ABSENT = {
  ConditionExpression: "attribute_not_exists(#pk)",
  ExpressionAttributeNames: { "#pk": LEARNER_TABLE_KEY.partition },
} as const;

/** An entry must still be at the version it was read at. */
function atVersion(version: number) {
  return {
    ConditionExpression: "#version = :version",
    ExpressionAttributeNames: { "#version": "version" },
    ExpressionAttributeValues: { ":version": version },
  };
}

/**
 * The one TransactWriteItems a commit becomes, in the learner's partition:
 * each put and update a conditional `Put`, each expectation a `ConditionCheck`.
 * An update replaces the whole entry, since every entry is written whole.
 */
export function transactItemsOf(
  table: string,
  partition: string,
  commit: Commit,
): TransactItem[] {
  const keyFor = (key: Key) => ({
    [LEARNER_TABLE_KEY.partition]: partition,
    [LEARNER_TABLE_KEY.sort]: sortKeyOf(key),
  });
  const item = (entry: Entry, version: number) => ({
    ...keyFor(keyOf(entry)),
    type: entry.type,
    version,
    value: entry.value,
  });
  return [
    ...commit.puts.map((entry) => ({
      Put: { TableName: table, Item: item(entry, 1), ...ABSENT },
    })),
    ...commit.updates.map(({ entry, version }) => ({
      Put: { TableName: table, Item: item(entry, version + 1), ...atVersion(version) },
    })),
    ...commit.expect.map(({ key, version }) => ({
      ConditionCheck: {
        TableName: table,
        Key: keyFor(key),
        ...(version === null ? ABSENT : atVersion(version)),
      },
    })),
  ];
}

/**
 * Cancellation reasons that mean "another write got there first", so the
 * command may load and decide again. `TransactionConflict` is one: a
 * concurrent transaction held an item, and nothing of this one was written.
 */
const RACED = new Set(["None", "ConditionalCheckFailed", "TransactionConflict"]);

/**
 * Whether a TransactWriteItems failure is the port's `ERR_CONFLICT`. Any other
 * cancellation — a validation error, an item grown too large, throttling — is
 * a fault a retry of the same command will not clear, so it is thrown.
 */
export function isConflict(error: unknown): boolean {
  if (!(error instanceof TransactionCanceledException)) {
    return false;
  }
  const codes = (error.CancellationReasons ?? []).map(
    (reason) => reason.Code ?? "None",
  );
  return (
    codes.some((code) => code !== "None") && codes.every((code) => RACED.has(code))
  );
}
