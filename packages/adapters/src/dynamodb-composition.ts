import {
  GetCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import type {
  Entry,
  Key,
  LearnerStore,
  Stored,
} from "@instant-composition/application";
import { storedOf, type ValueOf } from "./dynamodb-rows";
import { itemsPrefix, sortKeyOf } from "./keys";
import { cursorAfter, pageCursor, pageLimit, portionBounds } from "./page-cursor";

type CompositionReads = Pick<
  LearnerStore,
  | "compositionSource"
  | "compositionReadModel"
  | "compositionBuild"
  | "streakMigration"
  | "streakNeighbours"
  | "portionsPage"
  | "compositionItemsPage"
>;
export function dynamoCompositionReads(
  documents: DynamoDBDocumentClient,
  table: string,
  partition: string,
): CompositionReads {
  async function get<T extends Entry["type"]>(
    key: Key & { readonly type: T },
  ): Promise<Stored<ValueOf<T>> | undefined> {
    const { Item } = await documents.send(
      new GetCommand({
        TableName: table,
        Key: { PK: partition, SK: sortKeyOf(key) },
        ConsistentRead: true,
      }),
    );
    return Item === undefined ? undefined : storedOf(key.type, Item);
  }
  async function page<T extends Entry["type"]>(
    type: T,
    first: string,
    last: string,
    limit: number,
    cursor?: string,
  ) {
    pageLimit(limit);
    const scope = JSON.stringify([partition, type, first, last]);
    const after = cursorAfter(scope, cursor);
    if (after !== undefined && (after < first || after > last))
      throw new RangeError("Invalid page cursor key.");
    const result = await documents.send(
      new QueryCommand({
        TableName: table,
        ConsistentRead: true,
        Limit: limit,
        KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :first AND :last",
        ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
        ExpressionAttributeValues: { ":pk": partition, ":first": first, ":last": last },
        ...(after === undefined
          ? {}
          : { ExclusiveStartKey: { PK: partition, SK: after } }),
      }),
    );
    const next: unknown = result.LastEvaluatedKey?.["SK"];
    return {
      entries: (result.Items ?? []).map((row) => storedOf(type, row)),
      cursor: typeof next === "string" ? pageCursor(scope, next) : null,
    };
  }
  async function neighbour(day: string, forward: boolean) {
    const result = await documents.send(
      new QueryCommand({
        TableName: table,
        ConsistentRead: true,
        Limit: 1,
        ScanIndexForward: forward,
        KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :first AND :last",
        ExpressionAttributeNames: { "#pk": "PK", "#sk": "SK" },
        ExpressionAttributeValues: {
          ":pk": partition,
          ":first": forward ? `STREAK#${day}\u0000` : "STREAK#0000-00-00",
          ":last": forward ? "STREAK#9999-99-99" : `STREAK#${day}`,
        },
      }),
    );
    return (result.Items ?? []).map((row) => storedOf("streakRun", row));
  }
  return {
    compositionSource: () => get({ type: "compositionSource" }),
    compositionReadModel: (day) => get({ type: "compositionReadModel", day }),
    compositionBuild: (day) => get({ type: "compositionBuild", day }),
    streakMigration: () => get({ type: "streakMigration" }),
    async streakNeighbours(day) {
      const [left, right] = await Promise.all([
        neighbour(day, false),
        neighbour(day, true),
      ]);
      return [...left, ...right];
    },
    portionsPage(range) {
      portionBounds(range.from, range.to);
      return page(
        "portion",
        `PORTION#${range.from}`,
        `PORTION#${range.to}`,
        range.limit,
        range.cursor,
      );
    },
    compositionItemsPage(request) {
      const prefix = itemsPrefix("composition");
      return page("item", prefix, `${prefix}\uffff`, request.limit, request.cursor);
    },
  };
}
