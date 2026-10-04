import { storageFamilyBirth } from "./storage-families";
import type { Commit, Entry, Key } from "@instant-composition/application";
import { keyOf } from "@instant-composition/application";
import {
  decodeStorageRow,
  STORAGE_SCHEMA_VERSION,
  StorageSchemaError,
} from "./storage-schema";

/** The memory adapter uses the same family birth/current schema bounds as the wire. */
function supportedSourceSchema(type: Key["type"], schemaVersion: number): boolean {
  return (
    Number.isInteger(schemaVersion) &&
    schemaVersion >= storageFamilyBirth(type) &&
    schemaVersion <= STORAGE_SCHEMA_VERSION
  );
}

/** A memory source must still hold both its version and supported family schema. */
export function sourceVersionHolds(
  key: Key,
  source: { readonly version: number; readonly schemaVersion: number } | undefined,
  version: number | null,
): boolean {
  return (
    (source?.version ?? null) === version &&
    (source === undefined || supportedSourceSchema(key.type, source.schemaVersion))
  );
}

/** A source claim token survives a delete/recreate even when its version restarts. */
export function matchesModelClaim(
  entry: Entry | undefined,
  claim: string | undefined,
): boolean {
  return (
    claim === undefined ||
    (entry?.type === "modelTask" && entry.value.claimId === claim)
  );
}

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
