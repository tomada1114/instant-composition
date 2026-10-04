import {
  type Commit,
  type Stored,
  type CompositionSource,
  type ReadModelSource,
  type Entry,
} from "@instant-composition/application";
import {
  changesComposition,
  compactCompositionStats,
  compositionSourceMatches,
  withCompositionEpoch,
} from "./composition-epoch";
import { checkShape, sortKeyOf } from "./keys";
import { keyOf } from "@instant-composition/application";
import { storageKeysMatch } from "./storage-key-binding";
import { changesReadModelSource } from "./read-model-keys";
import { encodeStorageValue, StorageSchemaError } from "./storage-schema";

const VALIDATED = Symbol("validated-storage-commit");
export interface ValidatedCommit extends Commit {
  readonly [VALIDATED]: true;
}

/** This private adapter boundary validates incoming values before any normalization. */
export function validateProjectionCommit(
  supplied: Commit,
  partition: string,
): ValidatedCommit {
  checkShape(supplied);
  const checked = (entry: Entry): Entry => {
    const value = encodeStorageValue(entry.type, entry.value);
    if (!storageKeysMatch(entry.type, value, partition, sortKeyOf(keyOf(entry))))
      throw new StorageSchemaError("ERR_STORAGE_SHAPE", "key");
    return { type: entry.type, value } as Entry;
  };
  return {
    ...supplied,
    puts: supplied.puts.map(checked),
    updates: supplied.updates.map((update) => ({
      ...update,
      entry: checked(update.entry),
    })),
    [VALIDATED]: true,
  };
}

/** Fold explicit source guards into each automatic epoch's single conditional write. */
export function expandProjectionCommit(
  supplied: ValidatedCommit,
  composition: Stored<CompositionSource> | undefined,
  vocab: Stored<ReadModelSource> | undefined,
): ValidatedCommit | undefined {
  let commit = compactCompositionStats(supplied);
  const expand = (
    type: "compositionSource" | "readModelSource",
    version: number | null,
  ): boolean => {
    const expected = commit.expect.find(({ key }) => key.type === type);
    if (expected !== undefined && expected.version !== version) return false;
    if ((commit.deletes ?? []).some(({ key }) => key.type === type))
      throw new RangeError(
        "Source records and reserved epochs use separate maintenance commits.",
      );
    commit = {
      ...commit,
      expect: commit.expect.filter(({ key }) => key.type !== type),
    };
    return true;
  };
  if (changesComposition(commit)) {
    if (
      !compositionSourceMatches(commit, composition) ||
      !expand("compositionSource", composition?.version ?? null)
    )
      return undefined;
    commit = withCompositionEpoch(commit, composition);
  }
  if (changesReadModelSource(commit)) {
    if (
      (Object.hasOwn(commit, "readModelSourceVersion") &&
        commit.readModelSourceVersion !== (vocab?.version ?? null)) ||
      !expand("readModelSource", vocab?.version ?? null)
    )
      return undefined;
    if (
      [...commit.puts, ...commit.updates.map(({ entry }) => entry)].some(
        ({ type }) => type === "readModelSource",
      )
    )
      throw new RangeError(
        "Read-model sources and their reserved epochs use separate restore commits.",
      );
    const entry: Entry = { type: "readModelSource", value: { schema: 1 } };
    commit =
      vocab === undefined
        ? { ...commit, puts: [...commit.puts, entry] }
        : {
            ...commit,
            updates: [...commit.updates, { entry, version: vocab.version }],
          };
  }
  // Only generated epochs need a new decode; all supplied values retain the validated copy.
  const checkedEpoch = (entry: Entry): Entry =>
    entry.type === "compositionSource" || entry.type === "readModelSource"
      ? ({
          type: entry.type,
          value: encodeStorageValue(entry.type, entry.value),
        } as Entry)
      : entry;
  return {
    ...commit,
    puts: commit.puts.map(checkedEpoch),
    updates: commit.updates.map((update) => ({
      ...update,
      entry: checkedEpoch(update.entry),
    })),
    [VALIDATED]: true,
  };
}
