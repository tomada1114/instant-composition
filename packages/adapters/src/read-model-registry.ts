import type {
  DynamoDBDocumentClient,
  TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import {
  learnerId,
  type Commit,
  type LearnerId,
  type MaintenanceLearner,
  type Profile,
} from "@instant-composition/application";
import { encodeStorageValue, STORAGE_SCHEMA_VERSION } from "./storage-schema";
import { observedStorageGuard } from "./storage-observed";
import { observeDynamoStorage } from "./dynamodb-observed";

export const READ_MODEL_REGISTRY = "SYSTEM#READMODEL_LEARNERS";
type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];
export function registryLearner(value: unknown): MaintenanceLearner {
  const checked = encodeStorageValue("readModelLearner", value) as {
    readonly id: string;
    readonly profile: Profile;
  };
  return { id: learnerId(checked.id), profile: checked.profile };
}
export function registryKey(id: LearnerId): {
  readonly PK: string;
  readonly SK: string;
} {
  return { PK: READ_MODEL_REGISTRY, SK: encodeURIComponent(id) };
}
export function registryItem(
  id: LearnerId,
  profile: Profile,
  version: number,
): Record<string, unknown> {
  return {
    ...registryKey(id),
    type: "readModelLearner",
    version,
    schemaVersion: STORAGE_SCHEMA_VERSION,
    value: encodeStorageValue("readModelLearner", {
      schema: 1,
      id,
      profile,
    }),
  };
}
/** Profile and observed registry membership share the same conditional transaction. */
export async function profileRegistryWrites(
  documents: DynamoDBDocumentClient,
  table: string,
  partition: string,
  commit: Commit,
): Promise<TransactItem[]> {
  const profile = commit.puts.find((entry) => entry.type === "profile");
  const updated = commit.updates.find(({ entry }) => entry.type === "profile");
  const deleted = (commit.deletes ?? []).some(({ key }) => key.type === "profile");
  const entry = profile ?? updated?.entry;
  if (entry?.type !== "profile" && !deleted) return [];
  const id = learnerId(decodeURIComponent(partition.slice("LEARNER#".length)));
  const key = registryKey(id);
  const observed = await observeDynamoStorage(
    documents,
    table,
    "readModelLearner",
    key,
  );
  const guard = observedStorageGuard(observed);
  if (entry?.type === "profile")
    return [
      {
        Put: {
          TableName: table,
          Item: registryItem(id, entry.value, (updated?.version ?? 0) + 1),
          ...guard,
        },
      },
    ];
  return observed === undefined
    ? [{ ConditionCheck: { TableName: table, Key: key, ...guard } }]
    : [{ Delete: { TableName: table, Key: key, ...guard } }];
}
