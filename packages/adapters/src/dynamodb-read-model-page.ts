import { QueryCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Entry } from "@instant-composition/application";

import { storedOf } from "./dynamodb-rows";
import { LEARNER_TABLE_KEY } from "./keys";
import { pageCursor, pageStart } from "./read-model-keys";
import type { EntryPage } from "./read-model-reads";

export function dynamoDbPageReader(
  documents: DynamoDBDocumentClient,
  table: string,
  partition: string,
): EntryPage {
  return async <T extends Entry["type"]>(
    type: T,
    prefix: string,
    limit: number,
    cursor: string | null,
  ) => {
    const start = pageStart(partition, prefix, cursor);
    const result = await documents.send(
      new QueryCommand({
        TableName: table,
        ConsistentRead: true,
        KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :prefix)",
        ExpressionAttributeNames: {
          "#pk": LEARNER_TABLE_KEY.partition,
          "#sk": LEARNER_TABLE_KEY.sort,
        },
        ExpressionAttributeValues: { ":pk": partition, ":prefix": prefix },
        Limit: limit,
        ...(start === undefined
          ? {}
          : {
              ExclusiveStartKey: {
                [LEARNER_TABLE_KEY.partition]: partition,
                [LEARNER_TABLE_KEY.sort]: start,
              },
            }),
      }),
    );
    const last: unknown = result.LastEvaluatedKey?.[LEARNER_TABLE_KEY.sort];
    return {
      rows: (result.Items ?? []).map((row) => storedOf(type, row)),
      cursor: typeof last === "string" ? pageCursor(partition, prefix, last) : null,
    };
  };
}
