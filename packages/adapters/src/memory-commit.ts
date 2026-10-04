import {
  learnerId,
  type Commit,
  type CommitConflict,
} from "@instant-composition/application";
import { err, type Result } from "@instant-composition/domain";
import { changesComposition } from "./composition-epoch";
import { changesReadModelSource } from "./read-model-keys";
import { commitMemory, readMemory, memoryRow, type Slot } from "./memory-state";
import { expandProjectionCommit, validateProjectionCommit } from "./projection-commit";
import { registryItem, registryKey } from "./read-model-registry";
import { memorySystemKey, type MemorySystemRows } from "./memory-system";
import { keyOf } from "@instant-composition/application";
import { sortKeyOf } from "./keys";
import { transactItemsOf } from "./dynamodb-commit";
import { checkStorageBudget } from "./storage-budget";
import {
  observeStorageRow,
  observedStorageGuard,
  type ObservedStorage,
} from "./storage-observed";
import { StorageSchemaError } from "./storage-schema";

/** Learner, epochs and raw system registry apply in one synchronous boundary. */
export function commitMemoryStore(
  slots: Map<string, Slot>,
  supplied: Commit,
  system: MemorySystemRows,
  partition: string,
): Result<undefined, CommitConflict> {
  const validated = validateProjectionCommit(supplied, partition);
  try {
    const commit = expandProjectionCommit(
      validated,
      changesComposition(supplied)
        ? readMemory(slots, { type: "compositionSource" })
        : undefined,
      changesReadModelSource(supplied)
        ? readMemory(slots, { type: "readModelSource" })
        : undefined,
    );
    if (commit === undefined) return err({ code: "ERR_CONFLICT" });
    const profile = commit.puts.find((entry) => entry.type === "profile");
    const updated = commit.updates.find(({ entry }) => entry.type === "profile");
    const deleted = (commit.deletes ?? []).some(({ key }) => key.type === "profile");
    const entry = profile ?? updated?.entry;
    const changed = entry?.type === "profile" || deleted;
    const id = learnerId(decodeURIComponent(partition.slice("LEARNER#".length))),
      key = registryKey(id),
      systemKey = memorySystemKey(key);
    const current = changed
      ? observeStorageRow("readModelLearner", key, system.get(systemKey))
      : undefined;
    const mirror =
      entry?.type === "profile"
        ? registryItem(id, entry.value, (updated?.version ?? 0) + 1)
        : undefined;
    const observed = new Map<string, ObservedStorage | undefined>();
    for (const source of [
      ...commit.updates.map(({ entry }) => keyOf(entry)),
      ...commit.expect.map(({ key }) => key),
      ...(commit.deletes ?? []).map(({ key }) => key),
    ]) {
      const sk = sortKeyOf(source),
        slot = slots.get(sk);
      observed.set(
        sk,
        observeStorageRow(
          source.type,
          { PK: partition, SK: sk },
          slot === undefined ? undefined : memoryRow(slot, sk, partition),
        ),
      );
    }
    const registry = changed
      ? mirror !== undefined
        ? [
            {
              Put: {
                TableName: "memory",
                Item: mirror,
                ...observedStorageGuard(current),
              },
            },
          ]
        : current === undefined
          ? [
              {
                ConditionCheck: {
                  TableName: "memory",
                  Key: key,
                  ...observedStorageGuard(current),
                },
              },
            ]
          : [
              {
                Delete: {
                  TableName: "memory",
                  Key: key,
                  ...observedStorageGuard(current),
                },
              },
            ]
      : [];
    checkStorageBudget([
      ...transactItemsOf("memory", partition, commit, observed),
      ...registry,
    ]);
    const result = commitMemory(slots, commit);
    if (result.ok && changed) {
      if (mirror === undefined) system.delete(systemKey);
      else system.set(systemKey, mirror);
    }
    return result;
  } catch (error) {
    if (
      error instanceof StorageSchemaError &&
      error.code === "ERR_STORAGE_SCHEMA_UNKNOWN"
    )
      return err({ code: "ERR_CONFLICT" });
    throw error;
  }
}
