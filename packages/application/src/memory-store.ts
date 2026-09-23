import { err, ok, type ReviewEntry } from "@instant-composition/domain";

import type { LearnerId } from "./context";
import {
  keyOf,
  type Commit,
  type Entry,
  type Key,
  type LearnerStore,
  type LearnerStores,
  type Stored,
} from "./store";

/**
 * The most items one commit may name, puts, updates and expectations together:
 * DynamoDB's TransactWriteItems limit, held here too so a command that would
 * outgrow it fails against the fake first.
 */
export const MAX_COMMIT_ITEMS = 100;

interface Slot {
  readonly entry: Entry;
  readonly version: number;
}

type ValueOf<T extends Entry["type"]> = Extract<Entry, { type: T }>["value"];

/** Unambiguous whatever an id contains, and blind to property order. */
function encode(key: Key): string {
  switch (key.type) {
    case "settings":
    case "stats":
      return JSON.stringify([key.type]);
    case "round":
      return JSON.stringify([key.type, key.id]);
    case "review":
      return JSON.stringify([key.type, key.sessionId, key.id]);
    case "portion":
    case "day":
      return JSON.stringify([key.type, key.day]);
    case "item":
      return JSON.stringify([key.type, key.item.kind, key.item.id]);
  }
}

/** A serialized copy, as a real store hands back: no caller shares a stored object. */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function byTime(a: ReviewEntry, b: ReviewEntry): number {
  return a.answeredAt - b.answeredAt || a.id.localeCompare(b.id);
}

function checkShape(commit: Commit): void {
  const keys = [
    ...commit.puts.map((entry) => encode(keyOf(entry))),
    ...commit.updates.map(({ entry }) => encode(keyOf(entry))),
    ...commit.expect.map(({ key }) => encode(key)),
  ];
  if (keys.length > MAX_COMMIT_ITEMS) {
    throw new RangeError(`A commit names at most ${String(MAX_COMMIT_ITEMS)} items.`);
  }
  if (new Set(keys).size !== keys.length) {
    throw new RangeError("A commit names each key once.");
  }
  if (commit.updates.some(({ entry }) => entry.type === "review")) {
    throw new RangeError("The review log is append-only.");
  }
}

function memoryStore(slots: Map<string, Slot>, counted: () => void): LearnerStore {
  function read<T extends Entry["type"]>(
    key: Key & { readonly type: T },
  ): Stored<ValueOf<T>> | undefined {
    const slot = slots.get(encode(key));
    return slot === undefined
      ? undefined
      : { value: copy(slot.entry.value) as ValueOf<T>, version: slot.version };
  }

  function all<T extends Entry["type"]>(type: T): Stored<ValueOf<T>>[] {
    return [...slots.values()]
      .filter((slot) => slot.entry.type === type)
      .map((slot) => ({
        value: copy(slot.entry.value) as ValueOf<T>,
        version: slot.version,
      }));
  }

  function holds(key: Key, version: number | null): boolean {
    return (slots.get(encode(key))?.version ?? null) === version;
  }

  function reviews(sessionId?: string): readonly ReviewEntry[] {
    counted();
    return all("review")
      .map(({ value }) => value)
      .filter((review) => sessionId === undefined || review.sessionId === sessionId)
      .sort(byTime);
  }

  return {
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
    commit(commit) {
      checkShape(commit);
      const writes = [
        ...commit.puts.map((entry) => ({ entry, version: null })),
        ...commit.updates,
      ];
      const conflict =
        writes.some(({ entry, version }) => !holds(keyOf(entry), version)) ||
        commit.expect.some(({ key, version }) => !holds(key, version));
      if (conflict) {
        return Promise.resolve(err({ code: "ERR_CONFLICT" }));
      }
      for (const { entry, version } of writes) {
        slots.set(encode(keyOf(entry)), {
          entry: copy(entry),
          version: (version ?? 0) + 1,
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
