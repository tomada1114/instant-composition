import type {
  CardContent,
  CardFacts,
  Result,
  SubtopicRef,
  TombstoneMeta,
  TopicInfo,
} from "@instant-composition/domain";

/** The cards and their lists, as one read-only snapshot. */
export interface CatalogSnapshot {
  readonly topics: readonly TopicInfo[];
  readonly toeicByLevel: ReadonlyMap<number, string>;
  /** Cards whose review stamp matches: the only ones a round may deal. */
  readonly shown: ReadonlyMap<string, CardContent>;
  /** Every well-formed card, reviewed or not. */
  readonly known: ReadonlyMap<string, CardContent>;
  readonly tombstones: ReadonlyMap<string, TombstoneMeta>;
}

/** The catalog could not be read, so nothing can be dealt or checked against it. */
export interface CatalogUnreadable {
  readonly code: "ERR_CONTENT_UNREADABLE";
}

/** Files in development, a build-time snapshot in production. */
export interface Catalog {
  snapshot(): Promise<Result<CatalogSnapshot, CatalogUnreadable>>;
}

/** Every card an answer may name: the known ones, then the tombstones of deleted ones. */
export function cardFacts(snapshot: CatalogSnapshot): Map<string, CardFacts> {
  const facts = new Map<string, CardFacts>();
  for (const [id, tombstone] of snapshot.tombstones) {
    facts.set(id, { ...tombstone, words: null });
  }
  for (const [id, card] of snapshot.known) {
    facts.set(id, card);
  }
  return facts;
}

/** Where a card belongs now: its card, else its tombstone. */
export function placeOf(
  snapshot: CatalogSnapshot,
): (cardId: string) => SubtopicRef | undefined {
  return (cardId) => snapshot.known.get(cardId) ?? snapshot.tombstones.get(cardId);
}

export function toeicOf(snapshot: CatalogSnapshot, level: number): string {
  return snapshot.toeicByLevel.get(level) ?? "";
}

const EMPTY_SNAPSHOT: CatalogSnapshot = {
  topics: [],
  toeicByLevel: new Map(),
  shown: new Map(),
  known: new Map(),
  tombstones: new Map(),
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
