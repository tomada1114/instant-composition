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
import { err, ok, type ReviewEntry } from "@instant-composition/domain";

import { isConflict, transactItemsOf } from "./dynamodb-commit";
import { validateStorageSources } from "./storage-source";
import { byTime, storedOf, type Row, type ValueOf } from "./dynamodb-rows";
import {
  CARDS_PREFIX,
  checkShape,
  itemsPrefix,
  LEARNER_TABLE_KEY,
  partitionKeyOf,
  reviewsPrefix,
  sortKeyOf,
  vocabReviewsPrefix,
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

function dynamoDbStore(
  documents: DynamoDBDocumentClient,
  table: string,
  partition: string,
): LearnerStore {
  async function rawGet(key: Key): Promise<Row | undefined> {
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
    return Item;
  }

  async function get<T extends Entry["type"]>(
    key: Key & { readonly type: T },
  ): Promise<Stored<ValueOf<T>> | undefined> {
    const row = await rawGet(key);
    return row === undefined ? undefined : storedOf(key.type, row);
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

  function prefixed(prefix: string): Promise<Row[]> {
    return query("begins_with(#sk, :prefix)", { ":prefix": prefix });
  }

  async function reviews(prefix: string): Promise<readonly ReviewEntry[]> {
    const rows = await prefixed(prefix);
    return rows
      .filter((row) => row["type"] === "review")
      .map((row) => storedOf("review", row).value)
      .sort(byTime);
  }

  return {
    profile: () => get({ type: "profile" }),
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
          .map((row) => storedOf("day", row))
          .filter((stored) => wanted.has(stored.value.day))
          .map((stored) => [stored.value.day, stored]),
      );
    },
    async items() {
      // The drill's kind alone: a vocabulary card's progress is another shape.
      const rows = await prefixed(itemsPrefix("composition"));
      return new Map(
        rows
          .map((row) => storedOf("item", row))
          .map((stored) => [stored.value.item.id, stored]),
      );
    },
    talk: (id) => get({ type: "talk", id }),
    async vocabItems() {
      const rows = await prefixed(itemsPrefix("vocab"));
      return new Map(
        rows
          .map((row) => storedOf("vocabItem", row))
          .map((stored) => [stored.value.cardId, stored]),
      );
    },
    vocabSession: (id) => get({ type: "vocabSession", id }),
    async vocabReviewsOf(sessionId) {
      const rows = await prefixed(vocabReviewsPrefix(sessionId));
      // The prefix holds the session's answers alone, not the session itself.
      return rows.map((row) => storedOf("vocabReview", row).value).sort(byTime);
    },
    card: (id) => get({ type: "card", id }),
    async cards() {
      const rows = await prefixed(CARDS_PREFIX);
      return new Map(
        rows
          .map((row) => storedOf("card", row))
          .map((stored) => [stored.value.id, stored]),
      );
    },
    async commit(commit) {
      checkShape(commit);
      const items = transactItemsOf(table, partition, commit);
      if (items.length === 0) {
        return ok(undefined);
      }
      if (!(await validateStorageSources(commit, rawGet)))
        return err({ code: "ERR_CONFLICT" });
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
 * The learner stores on the single learner table: one partition per learner,
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
