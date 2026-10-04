import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  learnerId,
  type LearnerDirectory,
  type Profile,
} from "@instant-composition/application";
import { err, ok } from "@instant-composition/domain";

import { observeDynamoStorage } from "./dynamodb-observed";
import { registryKey, registryItem } from "./read-model-registry";
import { isConflict } from "./dynamodb-commit";
import {
  decodeStorageRow,
  encodeStorageValue,
  STORAGE_SCHEMA_VERSION,
  type StorageFamily,
} from "./storage-schema";
import type { DynamoDbStoresOptions } from "./dynamodb-store";
import {
  IDENTITY_SORT_KEY,
  identityKeyOf,
  LEARNER_TABLE_KEY,
  partitionKeyOf,
} from "./keys";

/** An item must not exist yet. */
const ABSENT = {
  ConditionExpression: "attribute_not_exists(#pk)",
  ExpressionAttributeNames: { "#pk": LEARNER_TABLE_KEY.partition },
} as const;

/**
 * The identity context's records on the learner table: `IDENTITY#<sub> / LEARNER` maps a subject to its LearnerId, and
 * `LEARNER#<id> / PROFILE` holds the profile inside the learner's own
 * partition. A registration writes both in one TransactWriteItems.
 */
export function createDynamoDbDirectory(
  options: DynamoDbStoresOptions,
): LearnerDirectory {
  const documents = DynamoDBDocumentClient.from(options.client, {
    marshallOptions: { removeUndefinedValues: true },
  });
  const table = options.tableName;

  async function get(
    partition: string,
    sort: string,
    type: StorageFamily,
  ): Promise<unknown> {
    const { Item } = await documents.send(
      new GetCommand({
        TableName: table,
        Key: {
          [LEARNER_TABLE_KEY.partition]: partition,
          [LEARNER_TABLE_KEY.sort]: sort,
        },
        ConsistentRead: true,
      }),
    );
    return Item === undefined ? undefined : decodeStorageRow(type, Item).value;
  }

  return {
    async learnerOf(subject) {
      const mapping = (await get(
        identityKeyOf(subject),
        IDENTITY_SORT_KEY.mapping,
        "identity",
      )) as { readonly learnerId: string } | undefined;
      if (mapping === undefined) {
        return undefined;
      }
      const id = learnerId(mapping.learnerId);
      const profile = (await get(
        partitionKeyOf(id),
        IDENTITY_SORT_KEY.profile,
        "profile",
      )) as Profile | undefined;
      if (profile === undefined) {
        throw new TypeError("A mapped learner has no profile.");
      }
      return { learnerId: id, profile };
    },
    async register(subject, registration) {
      const existing = await Promise.all([
        observeDynamoStorage(documents, table, "identity", {
          PK: identityKeyOf(subject),
          SK: IDENTITY_SORT_KEY.mapping,
        }),
        observeDynamoStorage(documents, table, "profile", {
          PK: partitionKeyOf(registration.learnerId),
          SK: IDENTITY_SORT_KEY.profile,
        }),
        observeDynamoStorage(
          documents,
          table,
          "readModelLearner",
          registryKey(registration.learnerId),
        ),
      ]);
      if (existing.some((row) => row !== undefined))
        return err({ code: "ERR_CONFLICT" });
      const put = (
        partition: string,
        sort: string,
        type: StorageFamily,
        value: object,
      ) => ({
        Put: {
          TableName: table,
          Item: {
            [LEARNER_TABLE_KEY.partition]: partition,
            [LEARNER_TABLE_KEY.sort]: sort,
            type,
            version: 1,
            schemaVersion: STORAGE_SCHEMA_VERSION,
            value: encodeStorageValue(type, value),
          },
          ...ABSENT,
        },
      });
      try {
        await documents.send(
          new TransactWriteCommand({
            TransactItems: [
              put(identityKeyOf(subject), IDENTITY_SORT_KEY.mapping, "identity", {
                learnerId: registration.learnerId,
              }),
              put(
                partitionKeyOf(registration.learnerId),
                IDENTITY_SORT_KEY.profile,
                "profile",
                registration.profile,
              ),
              {
                Put: {
                  TableName: table,
                  Item: registryItem(registration.learnerId, registration.profile, 1),
                  ...ABSENT,
                },
              },
            ],
          }),
        );
      } catch (error) {
        if (isConflict(error)) {
          return err({ code: "ERR_CONFLICT" });
        }
        throw error;
      }
      return ok(undefined);
    },
  };
}
