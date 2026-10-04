import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { observeStorageRow, observedStorageGuard } from "./storage-observed";
import { regionalDynamoDbClient } from "./dynamodb-client";
import { localDynamoDbClient } from "./dynamodb-local";
import {
  decodeStorageRecord,
  encodeStorageValue,
  STORAGE_SCHEMA_VERSION,
  StorageSchemaError,
} from "./storage-schema";

const key = z.strictObject({ PK: z.string().min(1), SK: z.string().min(1) });
const config = {
  table: z.string().min(1),
  region: z.literal("ap-northeast-1"),
  endpoint: z.string().optional(),
};
const request = z.discriminatedUnion("command", [
  z.strictObject({ ...config, command: z.literal("page"), cursor: key.nullable() }),
  z.strictObject({ ...config, command: z.literal("get"), key }),
  z.strictObject({
    ...config,
    command: z.literal("replace"),
    key,
    row: z.record(z.string(), z.unknown()),
    version: z.number().int().positive(),
    schema: z.number().int().nonnegative(),
  }),
]);

/** Explicit administrative seam for a storage migration across the table.
 * It is never reachable through a learner-bound store or an HTTP route.
 */
export async function executeStorageMaintenance(input: unknown): Promise<unknown> {
  const operation = request.parse(input);
  if (operation.command === "replace" && operation.schema > STORAGE_SCHEMA_VERSION)
    throw new StorageSchemaError("ERR_STORAGE_SCHEMA_UNKNOWN", "schemaVersion");
  const client =
    operation.endpoint === undefined
      ? regionalDynamoDbClient(operation.region)
      : localDynamoDbClient(operation.endpoint);
  const documents = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
  try {
    if (operation.command === "page") {
      const page = await documents.send(
        new ScanCommand({
          TableName: operation.table,
          Limit: 100,
          ConsistentRead: true,
          ...(operation.cursor === null ? {} : { ExclusiveStartKey: operation.cursor }),
        }),
      );
      return { rows: page.Items ?? [], cursor: page.LastEvaluatedKey ?? null };
    }
    if (operation.command === "get") {
      const answer = await documents.send(
        new GetCommand({
          TableName: operation.table,
          Key: operation.key,
          ConsistentRead: true,
        }),
      );
      return answer.Item ?? null;
    }
    const decoded = decodeStorageRecord(operation.row);
    if (
      decoded.schemaVersion !== STORAGE_SCHEMA_VERSION ||
      operation.row["PK"] !== operation.key.PK ||
      operation.row["SK"] !== operation.key.SK ||
      decoded.version !== operation.version + 1
    )
      throw new TypeError("Invalid migration replacement.");
    const value = encodeStorageValue(decoded.type, decoded.value);
    const source = await documents.send(
      new GetCommand({
        TableName: operation.table,
        Key: operation.key,
        ConsistentRead: true,
      }),
    );
    if (source.Item === undefined) return false;
    const prior = observeStorageRow(decoded.type, operation.key, source.Item);
    if (prior === undefined) return false;
    if (
      prior.type !== decoded.type ||
      prior.version !== operation.version ||
      prior.schemaVersion !== operation.schema
    )
      return false;
    try {
      await documents.send(
        new PutCommand({
          TableName: operation.table,
          Item: {
            ...operation.key,
            type: decoded.type,
            version: decoded.version,
            schemaVersion: STORAGE_SCHEMA_VERSION,
            value,
            ...(Object.hasOwn(operation.row, "expiresAt")
              ? { expiresAt: operation.row["expiresAt"] }
              : {}),
          },
          ...observedStorageGuard(prior),
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  } finally {
    client.destroy();
  }
}
