import {
  keyOf,
  type CommitConflict,
  type Entry,
  type Key,
  type Stored,
} from "@instant-composition/application";
import { err, ok, type Result } from "@instant-composition/domain";
import { checkShape, sortKeyOf } from "./keys";
import { pageCursor, pageStart } from "./read-model-keys";
import { copyEntry, type Slot, type ValueOf } from "./storage-memory";
import { sourceVersionHolds, matchesModelClaim } from "./storage-source";
import type { ValidatedCommit } from "./projection-commit";
import { STORAGE_SCHEMA_VERSION, decodeStorageRow } from "./storage-schema";
export type { Slot } from "./storage-memory";

export function memoryRow(
  slot: Slot,
  sort: string,
  partition = "LEARNER#memory",
): Readonly<Record<string, unknown>> {
  return {
    PK: partition,
    SK: sort,
    ...slot.entry,
    version: slot.version,
    schemaVersion: slot.schemaVersion,
    ...(slot.expiresAt === undefined ? {} : { expiresAt: slot.expiresAt }),
  };
}
function checked<T extends Entry["type"]>(
  slot: Slot,
  type: T,
  sort: string,
): Stored<ValueOf<T>> {
  const decoded = decodeStorageRow(type, memoryRow(slot, sort));
  return { value: decoded.value as ValueOf<T>, version: decoded.version };
}
export function readMemory<T extends Entry["type"]>(
  slots: ReadonlyMap<string, Slot>,
  key: Key & { readonly type: T },
): Stored<ValueOf<T>> | undefined {
  const sk = sortKeyOf(key),
    slot = slots.get(sk);
  return slot === undefined ? undefined : checked(slot, key.type, sk);
}
export function allMemory<T extends Entry["type"]>(
  slots: ReadonlyMap<string, Slot>,
  type: T,
): Stored<ValueOf<T>>[] {
  return [...slots]
    .filter(([, slot]) => slot.entry.type === type)
    .map(([sk, slot]) => checked(slot, type, sk));
}
export function pageMemory<T extends Entry["type"]>(
  slots: ReadonlyMap<string, Slot>,
  partition: string,
  type: T,
  prefix: string,
  limit: number,
  cursor: string | null,
): { readonly rows: readonly Stored<ValueOf<T>>[]; readonly cursor: string | null } {
  const start = pageStart(partition, prefix, cursor);
  const keys = [...slots.keys()]
    .filter((key) => key.startsWith(prefix) && (start === undefined || key > start))
    .sort();
  const chosen = keys.slice(0, limit);
  return {
    rows: chosen.flatMap((sk) => {
      const slot = slots.get(sk);
      return slot === undefined ? [] : [checked(slot, type, sk)];
    }),
    cursor:
      keys.length > chosen.length && chosen.at(-1) !== undefined
        ? pageCursor(partition, prefix, chosen.at(-1) ?? "")
        : null,
  };
}
/** Select primary keys before decoding values, as a bounded DynamoDB range does. */
export function rangeMemory<T extends Entry["type"]>(
  slots: ReadonlyMap<string, Slot>,
  type: T,
  first: string,
  last: string,
  limit: number,
  after: string | undefined,
  forward = true,
): {
  readonly rows: readonly {
    readonly key: string;
    readonly stored: Stored<ValueOf<T>>;
  }[];
  readonly more: boolean;
} {
  const keys = [...slots.keys()]
    .filter(
      (key) => key >= first && key <= last && (after === undefined || key > after),
    )
    .sort();
  if (!forward) keys.reverse();
  return {
    rows: keys.slice(0, limit).flatMap((key) => {
      const slot = slots.get(key);
      return slot === undefined ? [] : [{ key, stored: checked(slot, type, key) }];
    }),
    more: keys.length > limit,
  };
}
/** Prepare every source and encoded value before changing even one memory slot. */
export function commitMemory(
  slots: Map<string, Slot>,
  commit: ValidatedCommit,
): Result<undefined, CommitConflict> {
  checkShape(commit);
  const writes = [
    ...commit.puts.map((entry) => ({ entry, version: null })),
    ...commit.updates,
  ];
  const holds = (key: Key, version: number | null) =>
    sourceVersionHolds(key, slots.get(sortKeyOf(key)), version);
  if (
    writes.some(({ entry, version }) => !holds(keyOf(entry), version)) ||
    commit.updates.some(
      ({ entry, modelClaim }) =>
        !matchesModelClaim(slots.get(sortKeyOf(keyOf(entry)))?.entry, modelClaim),
    ) ||
    [...commit.expect, ...(commit.deletes ?? [])].some(
      ({ key, version }) => !holds(key, version),
    )
  )
    return err({ code: "ERR_CONFLICT" });
  const prepared = writes.map(({ entry, version }) => {
    const value = entry.value;
    const expiry: unknown = Reflect.get(value, "expiresAt");
    return {
      key: sortKeyOf(keyOf(entry)),
      slot: {
        entry: copyEntry({ type: entry.type, value }),
        version: (version ?? 0) + 1,
        schemaVersion: STORAGE_SCHEMA_VERSION,
        ...(typeof expiry === "number" ? { expiresAt: expiry } : {}),
      },
    };
  });
  for (const { key } of commit.deletes ?? []) slots.delete(sortKeyOf(key));
  for (const { key, slot } of prepared) slots.set(key, slot);
  return ok(undefined);
}
