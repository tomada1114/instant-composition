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

import { isConflict } from "./dynamodb-commit";
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

/** The `value` of a row this adapter wrote. Only it writes these rows, so the shape is trusted. */
function valueOf(row: Readonly<Record<string, unknown>> | undefined): unknown {
  const value = row?.["value"];
  if (row !== undefined && (typeof value !== "object" || value === null)) {
    throw new TypeError("An identity item has no value.");
  }
  return value;
}

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

  async function get(partition: string, sort: string): Promise<unknown> {
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
    return valueOf(Item);
  }

  return {
    async learnerOf(subject) {
      const mapping = (await get(identityKeyOf(subject), IDENTITY_SORT_KEY.mapping)) as
        { readonly learnerId: string } | undefined;
      if (mapping === undefined) {
        return undefined;
      }
      const id = learnerId(mapping.learnerId);
      const profile = (await get(partitionKeyOf(id), IDENTITY_SORT_KEY.profile)) as
        Profile | undefined;
      if (profile === undefined) {
        throw new TypeError("A mapped learner has no profile.");
      }
      return { learnerId: id, profile };
    },
    async register(subject, registration) {
      const put = (partition: string, sort: string, type: string, value: object) => ({
        Put: {
          TableName: table,
          Item: {
            [LEARNER_TABLE_KEY.partition]: partition,
            [LEARNER_TABLE_KEY.sort]: sort,
            type,
            version: 1,
            value,
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
