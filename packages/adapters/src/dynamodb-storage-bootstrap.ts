import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { ReadModelBootstrapStorage } from "@instant-composition/application";
import { err, ok } from "@instant-composition/domain";
import { decodeReadModelBootstrapState } from "./storage-bootstrap-schema";
import {
  decodeStorageRow,
  storageSchemaFence,
  STORAGE_SCHEMA_VERSION,
  StorageSchemaError,
} from "./storage-schema";

const KEY = { PK: "SYSTEM#READMODEL", SK: "BOOTSTRAP" } as const;
function active(version: number): void {
  // No initial cap1 process can touch this future global checkpoint.
  if (version < 4)
    throw new StorageSchemaError("ERR_STORAGE_SCHEMA_UNKNOWN", "readModelBootstrap");
}

export function createDynamoDbReadModelBootstrapStorage(options: {
  readonly client: DynamoDBClient;
  readonly tableName: string;
}): ReadModelBootstrapStorage {
  const documents = DynamoDBDocumentClient.from(options.client);
  const load = async () => {
    active(STORAGE_SCHEMA_VERSION);
    const response = await documents.send(
      new GetCommand({
        TableName: options.tableName,
        Key: KEY,
        ConsistentRead: true,
      }),
    );
    if (response.Item === undefined) return undefined;
    const row = decodeStorageRow("readModelBootstrap", response.Item);
    return { value: decodeReadModelBootstrapState(row.value), version: row.version };
  };
  return {
    checkpoint: load,
    async save(value, version) {
      active(STORAGE_SCHEMA_VERSION);
      const checked = decodeReadModelBootstrapState(value);
      if (version !== null) {
        const current = await load();
        if (current?.version !== version) return err({ code: "ERR_CONFLICT" });
      }
      const fence = storageSchemaFence();
      try {
        await documents.send(
          new PutCommand({
            TableName: options.tableName,
            Item: {
              ...KEY,
              type: "readModelBootstrap",
              version: (version ?? 0) + 1,
              schemaVersion: STORAGE_SCHEMA_VERSION,
              value: checked,
            },
            ConditionExpression:
              version === null
                ? "attribute_not_exists(#pk)"
                : `#version = :version AND ${fence.condition}`,
            ExpressionAttributeNames:
              version === null
                ? { "#pk": "PK" }
                : { "#version": "version", "#schema": "schemaVersion" },
            ...(version === null
              ? {}
              : {
                  ExpressionAttributeValues: { ":version": version, ...fence.values },
                }),
          }),
        );
        return ok(undefined);
      } catch (error) {
        if (error instanceof Error && error.name === "ConditionalCheckFailedException")
          return err({ code: "ERR_CONFLICT" });
        throw error;
      }
    },
  };
}
