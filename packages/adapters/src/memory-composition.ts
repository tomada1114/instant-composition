import type {
  Entry,
  Key,
  LearnerStore,
  Stored,
} from "@instant-composition/application";
import { cursorAfter, pageCursor, pageLimit, portionBounds } from "./page-cursor";
import { itemsPrefix } from "./keys";
import type { ValueOf } from "./dynamodb-rows";

interface MemoryReader {
  readonly partition: string;
  readonly read: <T extends Entry["type"]>(
    key: Key & { readonly type: T },
  ) => Stored<ValueOf<T>> | undefined;
  readonly range: <T extends Entry["type"]>(
    type: T,
    first: string,
    last: string,
    limit: number,
    after: string | undefined,
    forward?: boolean,
  ) => {
    readonly rows: readonly {
      readonly key: string;
      readonly stored: Stored<ValueOf<T>>;
    }[];
    readonly more: boolean;
  };
  readonly counted: () => void;
}
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
export function memoryCompositionReads(reader: MemoryReader): CompositionReads {
  const { read, range, counted } = reader;
  function point<T extends Entry["type"]>(key: Key & { readonly type: T }) {
    counted();
    return Promise.resolve(read<T>(key));
  }
  function page<T extends Entry["type"]>(
    type: T,
    first: string,
    last: string,
    limit: number,
    cursor?: string,
  ) {
    counted();
    pageLimit(limit);
    const scope = JSON.stringify([reader.partition, type, first, last]);
    const after = cursorAfter(scope, cursor);
    if (after !== undefined && (after < first || after > last))
      throw new RangeError("Invalid page cursor key.");
    const found = range(type, first, last, limit, after);
    const selected = found.rows;
    const next = selected.at(-1)?.key;
    return Promise.resolve({
      entries: selected.map((row) => row.stored),
      cursor: found.more && next !== undefined ? pageCursor(scope, next) : null,
    });
  }
  return {
    compositionSource: () => point({ type: "compositionSource" }),
    compositionReadModel: (day) => point({ type: "compositionReadModel", day }),
    compositionBuild: (day) => point({ type: "compositionBuild", day }),
    streakMigration: () => point({ type: "streakMigration" }),
    streakNeighbours(day) {
      counted();
      const left = range(
        "streakRun",
        "STREAK#0000-00-00",
        `STREAK#${day}`,
        1,
        undefined,
        false,
      ).rows[0]?.stored;
      const right = range(
        "streakRun",
        `STREAK#${day}\u0000`,
        "STREAK#9999-99-99",
        1,
        undefined,
      ).rows[0]?.stored;
      return Promise.resolve([left, right].filter((run) => run !== undefined));
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
