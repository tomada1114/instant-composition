import {
  keyOf,
  type Entry,
  type Key,
  type LearnerId,
  type LearnerStore,
  type LearnerStores,
  type Stored,
} from "@instant-composition/application";
import { err, ok, type ReviewEntry } from "@instant-composition/domain";

import { encodeStorageValue, STORAGE_SCHEMA_VERSION } from "./storage-schema";
import { copyEntry, readMemorySlot, type Slot, type ValueOf } from "./storage-memory";
import { checkShape, sortKeyOf } from "./keys";
import { keyedReads } from "./keyed-reads";
import { memoryReviewPage } from "./memory-review-page";

/** The fields both logs sort by. */
type Timed = Pick<ReviewEntry, "answeredAt" | "id">;

function byTime(a: Timed, b: Timed): number {
  return a.answeredAt - b.answeredAt || a.id.localeCompare(b.id);
}

function memoryStore(slots: Map<string, Slot>, counted: () => void): LearnerStore {
  function read<T extends Entry["type"]>(
    key: Extract<Key, { readonly type: T }>,
  ): Stored<ValueOf<T>> | undefined {
    const slot = slots.get(sortKeyOf(key));
    return slot === undefined ? undefined : readMemorySlot(key.type, slot);
  }

  function all<T extends Entry["type"]>(type: T): Stored<ValueOf<T>>[] {
    return [...slots.values()]
      .filter((slot) => slot.entry.type === type)
      .map((slot) => readMemorySlot(type, slot));
  }

  function holds(key: Key, version: number | null): boolean {
    const slot = slots.get(sortKeyOf(key));
    return (
      (slot?.version ?? null) === version &&
      (slot === undefined ||
        (Number.isInteger(slot.schemaVersion) &&
          slot.schemaVersion >= 0 &&
          slot.schemaVersion <= STORAGE_SCHEMA_VERSION))
    );
  }

  function reviews(sessionId?: string): readonly ReviewEntry[] {
    counted();
    return all("review")
      .map(({ value }) => value)
      .filter((review) => sessionId === undefined || review.sessionId === sessionId)
      .sort(byTime);
  }

  function get<T extends Entry["type"]>(
    key: Extract<Key, { readonly type: T }>,
  ): Promise<Stored<ValueOf<T>> | undefined> {
    counted();
    return Promise.resolve(read<T>(key));
  }
  return {
    ...keyedReads(get),
    reviewPage(sessionId, cursor) {
      counted();
      return Promise.resolve(memoryReviewPage(slots, sessionId, cursor));
    },
    profile() {
      counted();
      return Promise.resolve(read({ type: "profile" }));
    },
    settings() {
      counted();
      return Promise.resolve(read({ type: "settings" }));
    },
    stats() {
      counted();
      return Promise.resolve(read({ type: "stats" }));
    },
    round(id) {
      counted();
      return Promise.resolve(read({ type: "round", id }));
    },
    reviewsOf(sessionId) {
      return Promise.resolve(reviews(sessionId));
    },
    reviews() {
      return Promise.resolve(reviews());
    },
    portion(day) {
      counted();
      return Promise.resolve(read({ type: "portion", day }));
    },
    days(days) {
      counted();
      const found = days.flatMap((day) => {
        const tally = read({ type: "day", day });
        return tally === undefined ? [] : [[day, tally] as const];
      });
      return Promise.resolve(new Map(found));
    },
    items() {
      counted();
      return Promise.resolve(
        new Map(all("item").map((stored) => [stored.value.item.id, stored])),
      );
    },
    talk(id) {
      counted();
      return Promise.resolve(read({ type: "talk", id }));
    },
    vocabItems() {
      counted();
      return Promise.resolve(
        new Map(all("vocabItem").map((stored) => [stored.value.cardId, stored])),
      );
    },
    vocabSession(id) {
      counted();
      return Promise.resolve(read({ type: "vocabSession", id }));
    },
    vocabReviewsOf(sessionId) {
      counted();
      return Promise.resolve(
        all("vocabReview")
          .map(({ value }) => value)
          .filter((review) => review.sessionId === sessionId)
          .sort(byTime),
      );
    },
    card(id) {
      counted();
      return Promise.resolve(read({ type: "card", id }));
    },
    cards() {
      counted();
      return Promise.resolve(
        new Map(all("card").map((stored) => [stored.value.id, stored])),
      );
    },
    commit(commit) {
      checkShape(commit);
      const writes = [
        ...commit.puts.map((entry) => ({ entry, version: null })),
        ...commit.updates,
      ];
      const deletes = commit.deletes ?? [];
      const conflict =
        writes.some(({ entry, version }) => !holds(keyOf(entry), version)) ||
        [...commit.expect, ...deletes].some(({ key, version }) => !holds(key, version));
      if (conflict) {
        return Promise.resolve(err({ code: "ERR_CONFLICT" }));
      }
      // The same strict source validation protects legacy whole-row changes.
      for (const { entry } of commit.updates) read(keyOf(entry));
      for (const { key } of deletes) read(key);
      // Validate all writes before changing even one slot.
      for (const { entry } of writes) encodeStorageValue(entry.type, entry.value);
      for (const { key } of deletes) {
        slots.delete(sortKeyOf(key));
      }
      for (const { entry, version } of writes) {
        slots.set(sortKeyOf(keyOf(entry)), {
          entry: copyEntry({
            ...entry,
            value: encodeStorageValue(entry.type, entry.value),
          }),
          version: (version ?? 0) + 1,
          schemaVersion: STORAGE_SCHEMA_VERSION,
        });
      }
      return Promise.resolve(ok(undefined));
    },
  };
}

/** A store for tests and local runs, holding every learner's data in memory. */
export interface MemoryStores extends LearnerStores {
  /** Reads made so far through any learner's store; one per method call. */
  readCount(): number;
}

export function createMemoryStores(): MemoryStores {
  const partitions = new Map<LearnerId, Map<string, Slot>>();
  let reads = 0;
  const counted = (): void => {
    reads += 1;
  };
  return {
    readCount: () => reads,
    forLearner(id) {
      const slots = partitions.get(id) ?? new Map<string, Slot>();
      partitions.set(id, slots);
      return memoryStore(slots, counted);
    },
  };
}
