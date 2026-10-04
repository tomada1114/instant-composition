import {
  type Entry,
  type Key,
  type LearnerId,
  type LearnerStore,
  type LearnerStores,
  type ReadModelMaintenance,
} from "@instant-composition/application";
import { type ReviewEntry } from "@instant-composition/domain";

import { commitMemoryStore } from "./memory-commit";
import { memoryCompositionReads } from "./memory-composition";
import { memoryReadModelMaintenance } from "./memory-read-model-maintenance";
import { partitionKeyOf } from "./keys";
import {
  allMemory,
  pageMemory,
  rangeMemory,
  readMemory,
  type Slot,
} from "./memory-state";
import { readModelReads } from "./read-model-reads";
import { memorySystemKey, type MemorySystemRows } from "./memory-system";
import { memoryReviewPage } from "./memory-review-page";

/** The fields both logs sort by. */
type Timed = Pick<ReviewEntry, "answeredAt" | "id">;

function byTime(a: Timed, b: Timed): number {
  return a.answeredAt - b.answeredAt || a.id.localeCompare(b.id);
}

function memoryStore(
  slots: Map<string, Slot>,
  counted: () => void,
  partition: string,
  system: MemorySystemRows,
): LearnerStore {
  const read = <T extends Entry["type"]>(key: Key & { readonly type: T }) =>
    readMemory<T>(slots, key);
  const all = <T extends Entry["type"]>(type: T) => allMemory(slots, type);
  function reviews(sessionId?: string): readonly ReviewEntry[] {
    counted();
    return all("review")
      .map(({ value }) => value)
      .filter((review) => sessionId === undefined || review.sessionId === sessionId)
      .sort(byTime);
  }

  return {
    ...memoryCompositionReads({
      partition,
      read: (key) => read<typeof key.type>(key),
      range: (type, first, last, limit, after, forward) =>
        rangeMemory(slots, type, first, last, limit, after, forward),
      counted,
    }),
    ...readModelReads(
      async (key) => {
        counted();
        return Promise.resolve(read<typeof key.type>(key));
      },
      async (type, prefix, limit, cursor) => {
        counted();
        return Promise.resolve(
          pageMemory(slots, partition, type, prefix, limit, cursor),
        );
      },
      partition,
    ),
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
    reviewPage(sessionId, cursor) {
      counted();
      return Promise.resolve(memoryReviewPage(slots, sessionId, cursor));
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
    modelTask(task) {
      counted();
      return Promise.resolve(read({ type: "modelTask", task }));
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
    commit: async (commit) =>
      Promise.resolve(commitMemoryStore(slots, commit, system, partition)),
  };
}

/** A store for tests and local runs, holding every learner's data in memory. */
export interface MemoryStores extends LearnerStores {
  /** Reads made so far through any learner's store; one per method call. */
  readCount(): number;
  maintenance(): ReadModelMaintenance;
}

export function createMemoryStores(
  options: { readonly systemRows?: readonly unknown[] } = {},
): MemoryStores {
  const partitions = new Map<LearnerId, Map<string, Slot>>();
  const system: MemorySystemRows = new Map();
  for (const raw of options.systemRows ?? []) {
    if (
      typeof raw !== "object" ||
      raw === null ||
      !("PK" in raw) ||
      !("SK" in raw) ||
      typeof raw.PK !== "string" ||
      typeof raw.SK !== "string"
    )
      throw new TypeError("Trusted initial system rows need complete primary keys.");
    const copy = JSON.parse(JSON.stringify(raw)) as Readonly<Record<string, unknown>>;
    system.set(memorySystemKey({ PK: raw.PK, SK: raw.SK }), copy);
  }
  const maintenance = memoryReadModelMaintenance(system);
  let reads = 0;
  const counted = (): void => {
    reads += 1;
  };
  return {
    readCount: () => reads,
    maintenance: () => maintenance,
    forLearner(id) {
      const slots = partitions.get(id) ?? new Map<string, Slot>();
      partitions.set(id, slots);
      return memoryStore(slots, counted, partitionKeyOf(id), system);
    },
  };
}
