import type { Commit, Key } from "@instant-composition/application";
import { keyOf } from "@instant-composition/application";
import { decodeStorageRow, StorageSchemaError } from "./storage-schema";

/** Whole-row updates/deletions must decode their source, including unversioned
 * legacy rows. The transaction's version/schema fence still closes the read race.
 */
export async function validateStorageSources(
  commit: Commit,
  read: (key: Key) => Promise<unknown>,
): Promise<boolean> {
  const sources = [
    ...commit.updates.map(({ entry, version }) => ({ key: keyOf(entry), version })),
    ...(commit.deletes ?? []),
  ];
  for (const { key, version } of sources) {
    const row = await read(key);
    if (row === undefined) continue; // The existing CAS refuses a missing source.
    try {
      if (decodeStorageRow(key.type, row).version !== version) return false;
    } catch (error) {
      if (
        error instanceof StorageSchemaError &&
        error.code === "ERR_STORAGE_SCHEMA_UNKNOWN"
      )
        return false;
      throw error;
    }
  }
  return true;
}
