import type { SystemRecord } from "./system-record";
import { PutCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { err, ok } from "@instant-composition/domain";
import { observeDynamoStorage } from "./dynamodb-observed";
import { observedStorageGuard, type StoragePrimaryKey } from "./storage-observed";
import {
  encodeStorageValue,
  STORAGE_SCHEMA_VERSION,
  type StorageFamily,
} from "./storage-schema";

/** Trusted global records obey the same decoded-source CAS as learner records. */
export function dynamoSystemRecord<T>(
  documents: DynamoDBDocumentClient,
  table: string,
  type: StorageFamily,
  key: StoragePrimaryKey,
  decode: (value: unknown) => T,
): SystemRecord<T> {
  const observe = () => observeDynamoStorage(documents, table, type, key);
  return {
    async checkpoint() {
      const row = await observe();
      return row === undefined
        ? undefined
        : { value: decode(row.value), version: row.version };
    },
    async save(value: T, version: number | null) {
      const checked = encodeStorageValue(type, value);
      const current = await observe();
      if ((current?.version ?? null) !== version)
        return err({ code: "ERR_CONFLICT" } as const);
      try {
        await documents.send(
          new PutCommand({
            TableName: table,
            Item: {
              ...key,
              type,
              version: (version ?? 0) + 1,
              schemaVersion: STORAGE_SCHEMA_VERSION,
              value: checked,
            },
            ...observedStorageGuard(current),
          }),
        );
        return ok(undefined);
      } catch (error) {
        if (error instanceof Error && error.name === "ConditionalCheckFailedException")
          return err({ code: "ERR_CONFLICT" } as const);
        throw error;
      }
    },
  };
}
