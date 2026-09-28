import type {
  CardContent,
  CardFacts,
  ConceptId,
  RetiredCard,
  Result,
  SubtopicRef,
  TopicInfo,
} from "@instant-composition/domain";

/** One step of the target's 1–10 ladder: its CEFR band and its exam reference. */
export interface LevelInfo {
  readonly cefr: string;
  readonly toeic: string;
}

/** One language pair's cards and lists, resolved for the learner's first language. */
export interface CatalogSnapshot {
  /** The content hash of the snapshot this was read from. */
  readonly version: string;
  /** The language the cards are practised in, such as `en`. */
  readonly target: string;
  /** The first language the snapshot is resolved for, such as `ja`. */
  readonly l1: string;
  readonly topics: readonly TopicInfo[];
  readonly levels: ReadonlyMap<number, LevelInfo>;
  /** Each concept's name in `l1`, in the catalog's order; its id when it has none. */
  readonly conceptNames: ReadonlyMap<ConceptId, string>;
  /** Cards whose review stamp matches: the only ones a round may deal or show. */
  readonly shown: ReadonlyMap<string, CardContent>;
  /** Cards an answer may still name although they are not shown. */
  readonly retired: ReadonlyMap<string, RetiredCard>;
}

/** The catalog could not be read, so nothing can be dealt or checked against it. */
export interface CatalogUnreadable {
  readonly code: "ERR_CONTENT_UNREADABLE";
  /**
   * `missing` when there is no file — run `pnpm catalog:build` — `unreadable` when
   * the file exists but could not be read, and `malformed` when it was read but is
   * not a snapshot this build accepts.
   */
  readonly reason: "missing" | "unreadable" | "malformed";
}

/** Files in development, a build-time snapshot in production. */
export interface Catalog {
  snapshot(): Promise<Result<CatalogSnapshot, CatalogUnreadable>>;
}

/** Every card an answer may name: the retired ones, then the shown ones over them. */
export function cardFacts(snapshot: CatalogSnapshot): Map<string, CardFacts> {
  const facts = new Map<string, CardFacts>(snapshot.retired);
  for (const [id, card] of snapshot.shown) {
    facts.set(id, card);
  }
  return facts;
}

/** Where a card belongs now: its shown card, else its retired entry. */
export function placeOf(
  snapshot: CatalogSnapshot,
): (cardId: string) => SubtopicRef | undefined {
  return (cardId) => snapshot.shown.get(cardId) ?? snapshot.retired.get(cardId);
}

export function toeicOf(snapshot: CatalogSnapshot, level: number): string {
  return snapshot.levels.get(level)?.toeic ?? "";
}

const EMPTY_SNAPSHOT: CatalogSnapshot = {
  version: "",
  target: "",
  l1: "",
  topics: [],
  levels: new Map(),
  conceptNames: new Map(),
  shown: new Map(),
  retired: new Map(),
};

/** The snapshot, or an empty one a screen can still be drawn from when it cannot be read. */
export async function snapshotOrEmpty(
  catalog: Catalog,
): Promise<{ readonly snapshot: CatalogSnapshot; readonly unreadable: boolean }> {
  const read = await catalog.snapshot();
  return read.ok
    ? { snapshot: read.value, unreadable: false }
    : { snapshot: EMPTY_SNAPSHOT, unreadable: true };
}
