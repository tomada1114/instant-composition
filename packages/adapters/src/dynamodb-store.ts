import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  paginateQuery,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  Entry,
  Key,
  LearnerStore,
  LearnerStores,
  Stored,
} from "@instant-composition/application";
import {
  err,
  ok,
  type DayTally,
  type ItemProgress,
  type ReviewEntry,
} from "@instant-composition/domain";

import { isConflict, transactItemsOf } from "./dynamodb-commit";
import {
  checkShape,
  LEARNER_TABLE_KEY,
  partitionKeyOf,
  reviewsPrefix,
  sortKeyOf,
} from "./keys";

export interface DynamoDbStoresOptions {
  /**
   * A client whose endpoint, region and credentials the caller chose. The
   * adapter never builds one, so where its data goes is decided in one place.
   */
  readonly client: DynamoDBClient;
  /** The learner table, keyed by {@link LEARNER_TABLE_KEY}. */
  readonly tableName: string;
}

type Row = Readonly<Record<string, unknown>>;
type ValueOf<T extends Entry["type"]> = Extract<Entry, { type: T }>["value"];

/** A row as the port hands it back. Only this adapter writes the table, so the value is trusted. */
function storedOf<T>(row: Row): Stored<T> {
  const { value, version } = row;
  if (typeof version !== "number" || typeof value !== "object" || value === null) {
    throw new TypeError("A learner table item has no value or no version.");
  }
  return { value: value as T, version };
}

function byTime(a: ReviewEntry, b: ReviewEntry): number {
  return a.answeredAt - b.answeredAt || a.id.localeCompare(b.id);
}

function dynamoDbStore(
  documents: DynamoDBDocumentClient,
  table: string,
  partition: string,
): LearnerStore {
  async function get<T extends Entry["type"]>(
    key: Key & { readonly type: T },
  ): Promise<Stored<ValueOf<T>> | undefined> {
    const { Item } = await documents.send(
      new GetCommand({
        TableName: table,
        Key: {
          [LEARNER_TABLE_KEY.partition]: partition,
          [LEARNER_TABLE_KEY.sort]: sortKeyOf(key),
        },
        ConsistentRead: true,
      }),
    );
    return Item === undefined ? undefined : storedOf<ValueOf<T>>(Item);
  }

  /** Every row of the partition whose sort key meets `condition`, across pages. */
  async function query(
    condition: string,
    values: Record<string, string>,
  ): Promise<Row[]> {
    const rows: Row[] = [];
    const pages = paginateQuery(
      { client: documents },
      {
        TableName: table,
        ConsistentRead: true,
        KeyConditionExpression: `#pk = :pk AND ${condition}`,
        ExpressionAttributeNames: {
          "#pk": LEARNER_TABLE_KEY.partition,
          "#sk": LEARNER_TABLE_KEY.sort,
        },
        ExpressionAttributeValues: { ":pk": partition, ...values },
      },
    );
    for await (const page of pages) {
      rows.push(...(page.Items ?? []));
    }
    return rows;
  }

  async function reviews(prefix: string): Promise<readonly ReviewEntry[]> {
    const rows = await query("begins_with(#sk, :prefix)", { ":prefix": prefix });
    return rows
      .filter((row) => row["type"] === "review")
      .map((row) => storedOf<ReviewEntry>(row).value)
      .sort(byTime);
  }

  return {
    settings: () => get({ type: "settings" }),
    stats: () => get({ type: "stats" }),
    round: (id) => get({ type: "round", id }),
    reviewsOf: (sessionId) => reviews(reviewsPrefix(sessionId)),
    reviews: () => reviews("ROUND#"),
    portion: (day) => get({ type: "portion", day }),
    async days(days) {
      const keys = days.map((day) => sortKeyOf({ type: "day", day })).sort();
      const [first, last] = [keys[0], keys.at(-1)];
      if (first === undefined || last === undefined) {
        return new Map();
      }
      // Day keys sort as dates, so the window a caller asks for is one range.
      const rows = await query("#sk BETWEEN :first AND :last", {
        ":first": first,
        ":last": last,
      });
      const wanted = new Set(days);
      return new Map(
        rows
          .map((row) => storedOf<DayTally>(row))
          .filter((stored) => wanted.has(stored.value.day))
          .map((stored) => [stored.value.day, stored]),
      );
    },
    async items() {
      const rows = await query("begins_with(#sk, :prefix)", { ":prefix": "ITEM#" });
      return new Map(
        rows
          .map((row) => storedOf<ItemProgress>(row))
          .map((stored) => [stored.value.item.id, stored]),
      );
    },
    async commit(commit) {
      checkShape(commit);
      const items = transactItemsOf(table, partition, commit);
      if (items.length === 0) {
        return ok(undefined);
      }
      try {
        await documents.send(new TransactWriteCommand({ TransactItems: items }));
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

/**
 * The learner stores on ADR-0006's single table: one partition per learner,
 * reads made strongly consistent, each commit one TransactWriteItems.
 */
export function createDynamoDbStores(options: DynamoDbStoresOptions): LearnerStores {
  const documents = DynamoDBDocumentClient.from(options.client, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return {
    forLearner: (id) => dynamoDbStore(documents, options.tableName, partitionKeyOf(id)),
  };
}
