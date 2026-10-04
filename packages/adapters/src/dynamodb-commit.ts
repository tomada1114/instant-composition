import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { keyOf, type Entry, type Key } from "@instant-composition/application";

import type { ValidatedCommit } from "./projection-commit";
import { observedStorageGuard, type ObservedStorage } from "./storage-observed";
import { LEARNER_TABLE_KEY, sortKeyOf } from "./keys";
import { STORAGE_SCHEMA_VERSION, storageSchemaFence } from "./storage-schema";

type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

/** An entry must not exist yet: the condition that turns a resent answer into a conflict. */
const ABSENT = {
  ConditionExpression: "attribute_not_exists(#pk)",
  ExpressionAttributeNames: { "#pk": LEARNER_TABLE_KEY.partition },
} as const;

/** An entry must still be at the version it was read at. */
function atVersion(version: number, type: Key["type"], modelClaim?: string) {
  const fence = storageSchemaFence(type);
  return {
    ConditionExpression: `#version = :version AND ${fence.condition}${modelClaim === undefined ? "" : " AND #value.#claim = :claim"}`,
    ExpressionAttributeNames: {
      "#version": "version",
      "#schema": "schemaVersion",
      ...(modelClaim === undefined ? {} : { "#value": "value", "#claim": "claimId" }),
    },
    ExpressionAttributeValues: {
      ":version": version,
      ...fence.values,
      ...(modelClaim === undefined ? {} : { ":claim": modelClaim }),
    },
  };
}

/**
 * The table's TTL attribute for an entry that lapses: a talk not yet kept.
 * It sits beside `value`, where the TTL reads it, and a talk written without
 * one drops it, since every write replaces the whole item.
 */
function expiryOf(entry: Entry): { readonly expiresAt?: number } {
  return [
    "talk",
    "modelTask",
    "vocabReadModel",
    "vocabCandidate",
    "compositionReadModel",
    "compositionBuild",
    "compositionCandidate",
  ].includes(entry.type) && "expiresAt" in entry.value
    ? { expiresAt: entry.value.expiresAt }
    : {};
}

/**
 * The one TransactWriteItems a commit becomes, in the learner's partition:
 * each put and update a conditional `Put`, each expectation a `ConditionCheck`,
 * each delete a `Delete` at the version read.
 * An update replaces the whole entry, since every entry is written whole.
 */
export function transactItemsOf(
  table: string,
  partition: string,
  commit: ValidatedCommit,
  observed: ReadonlyMap<string, ObservedStorage | undefined> = new Map(),
): TransactItem[] {
  const keyFor = (key: Key) => ({
    [LEARNER_TABLE_KEY.partition]: partition,
    [LEARNER_TABLE_KEY.sort]: sortKeyOf(key),
  });
  const guard = (key: Key, version: number | null, modelClaim?: string) => {
    const sk = sortKeyOf(key);
    if (!observed.has(sk))
      return version === null ? ABSENT : atVersion(version, key.type, modelClaim);
    const prepared = observedStorageGuard(observed.get(sk));
    return modelClaim === undefined
      ? prepared
      : {
          ...prepared,
          ConditionExpression: `${prepared.ConditionExpression} AND #value.#claim = :claim`,
          ExpressionAttributeNames: {
            ...prepared.ExpressionAttributeNames,
            "#claim": "claimId",
          },
          ExpressionAttributeValues: {
            ...prepared.ExpressionAttributeValues,
            ":claim": modelClaim,
          },
        };
  };
  const item = (entry: Entry, version: number) => ({
    ...keyFor(keyOf(entry)),
    type: entry.type,
    version,
    schemaVersion: STORAGE_SCHEMA_VERSION,
    value: entry.value,
    ...expiryOf(entry),
  });
  return [
    ...commit.puts.map((entry) => ({
      Put: { TableName: table, Item: item(entry, 1), ...ABSENT },
    })),
    ...commit.updates.map(({ entry, version, modelClaim }) => ({
      Put: {
        TableName: table,
        Item: item(entry, version + 1),
        ...guard(keyOf(entry), version, modelClaim),
      },
    })),
    ...commit.expect.map(({ key, version }) => ({
      ConditionCheck: {
        TableName: table,
        Key: keyFor(key),
        ...guard(key, version),
      },
    })),
    ...(commit.deletes ?? []).map(({ key, version }) => ({
      Delete: { TableName: table, Key: keyFor(key), ...guard(key, version) },
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
