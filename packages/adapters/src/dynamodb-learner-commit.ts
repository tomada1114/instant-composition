import {
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import {
  keyOf,
  type Commit,
  type CommitConflict,
  type CompositionSource,
  type ReadModelSource,
  type Key,
  type Stored,
} from "@instant-composition/application";
import { err, ok, type Result } from "@instant-composition/domain";
import { changesComposition } from "./composition-epoch";
import { changesReadModelSource } from "./read-model-keys";
import { isConflict, transactItemsOf } from "./dynamodb-commit";
import { checkShape, sortKeyOf } from "./keys";
import { expandProjectionCommit, validateProjectionCommit } from "./projection-commit";
import { observeStorageRow, type ObservedStorage } from "./storage-observed";
import { StorageSchemaError } from "./storage-schema";
import { checkStorageBudget } from "./storage-budget";
import { profileRegistryWrites } from "./read-model-registry";

/** All strict source/global preimages and automatic epochs precede one conditional write. */
export async function dynamoLearnerCommit(
  documents: DynamoDBDocumentClient,
  table: string,
  partition: string,
  read: (key: Key) => Promise<unknown>,
  supplied: Commit,
): Promise<Result<undefined, CommitConflict>> {
  const validated = validateProjectionCommit(supplied);
  const observed = new Map<string, ObservedStorage | undefined>();
  const observe = async (key: Key): Promise<ObservedStorage | undefined> => {
    const sk = sortKeyOf(key);
    if (!observed.has(sk))
      observed.set(
        sk,
        observeStorageRow(key.type, { PK: partition, SK: sk }, await read(key)),
      );
    return observed.get(sk);
  };
  try {
    const composition = changesComposition(supplied)
      ? await observe({ type: "compositionSource" })
      : undefined;
    const vocab = changesReadModelSource(supplied)
      ? await observe({ type: "readModelSource" })
      : undefined;
    const stored = <T>(row: ObservedStorage | undefined): Stored<T> | undefined =>
      row === undefined ? undefined : { value: row.value as T, version: row.version };
    const commit = expandProjectionCommit(
      validated,
      stored<CompositionSource>(composition),
      stored<ReadModelSource>(vocab),
    );
    if (commit === undefined) return err({ code: "ERR_CONFLICT" });
    checkShape(commit);
    for (const { key, version } of [
      ...commit.updates.map(({ entry, version }) => ({ key: keyOf(entry), version })),
      ...commit.expect,
      ...(commit.deletes ?? []),
    ]) {
      const row = await observe(key);
      if ((row?.version ?? null) !== version) return err({ code: "ERR_CONFLICT" });
    }
    const items = [
      ...transactItemsOf(table, partition, commit, observed),
      ...(await profileRegistryWrites(documents, table, partition, commit)),
    ];
    checkStorageBudget(items);
    if (items.length === 0) return ok(undefined);
    await documents.send(new TransactWriteCommand({ TransactItems: items }));
    return ok(undefined);
  } catch (error) {
    if (
      isConflict(error) ||
      (error instanceof StorageSchemaError &&
        error.code === "ERR_STORAGE_SCHEMA_UNKNOWN")
    )
      return err({ code: "ERR_CONFLICT" });
    throw error;
  }
}
