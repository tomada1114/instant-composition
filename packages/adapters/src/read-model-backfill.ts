import {
  DynamoDBDocumentClient,
  ScanCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { learnerId, type Profile } from "@instant-composition/application";
import type { DynamoDbStoresOptions } from "./dynamodb-store";
import { observeStorageRow, observedStorageGuard } from "./storage-observed";
import { observeDynamoStorage } from "./dynamodb-observed";
import { registryItem, registryKey } from "./read-model-registry";
import { maintenancePageKey } from "./read-model-maintenance-key";

/** Explicit legacy discovery: one fixed Scan page, separate from ordinary worker enumeration. */
export async function backfillReadModelLearners(
  options: DynamoDbStoresOptions,
  cursor: string | null,
): Promise<{ readonly cursor: string | null; readonly rows: number }> {
  const documents = DynamoDBDocumentClient.from(options.client);
  const start = maintenancePageKey(cursor);
  const page = await documents.send(
    new ScanCommand({
      TableName: options.tableName,
      ConsistentRead: true,
      Limit: 100,
      FilterExpression: "#sk = :profile AND begins_with(#pk, :learner)",
      ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
      ExpressionAttributeValues: { ":profile": "PROFILE", ":learner": "LEARNER#" },
      ...(start === undefined ? {} : { ExclusiveStartKey: start }),
    }),
  );
  for (const row of page.Items ?? []) {
    const partition: unknown = row["PK"];
    if (typeof partition !== "string" || row["type"] !== "profile")
      throw new TypeError("A legacy profile has no learner partition.");
    const profile = observeStorageRow("profile", { PK: partition, SK: "PROFILE" }, row);
    if (profile === undefined) throw new TypeError("A scanned profile is absent.");
    const id = learnerId(decodeURIComponent(partition.slice("LEARNER#".length)));
    const registry = await observeDynamoStorage(
      documents,
      options.tableName,
      "readModelLearner",
      registryKey(id),
    );
    const mirror = registryItem(id, profile.value as Profile, profile.version);
    if (
      registry?.version === profile.version &&
      JSON.stringify(registry.value) === JSON.stringify(mirror["value"])
    )
      continue;
    await documents.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: options.tableName,
              Key: { PK: partition, SK: "PROFILE" },
              ...observedStorageGuard(profile),
            },
          },
          {
            Put: {
              TableName: options.tableName,
              Item: mirror,
              ...observedStorageGuard(registry),
            },
          },
        ],
      }),
    );
  }
  return {
    cursor:
      page.LastEvaluatedKey === undefined
        ? null
        : JSON.stringify(page.LastEvaluatedKey),
    rows: page.ScannedCount ?? 0,
  };
}
