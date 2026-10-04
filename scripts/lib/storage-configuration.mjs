import { readKey } from "./json.mjs";
import { storageDigest, StorageTransitionError } from "./storage-runtime.mjs";

/** Canonical JSON retains array order and every nested field.
 * @param {unknown} value @returns {unknown}
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null) {
    if (
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null) ||
      Object.getOwnPropertySymbols(value).length > 0
    )
      throw new StorageTransitionError("configuration shape");
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(readKey(value, key))]),
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  throw new StorageTransitionError("configuration shape");
}

/** Only revision/timestamp metadata may change across our concurrency operation.
 * Raw configuration (including Environment) never leaves this digest boundary.
 * @param {unknown} value @returns {string}
 */
export function storageConfigurationHash(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new StorageTransitionError("configuration shape");
  const stable = Object.fromEntries(
    Object.keys(value)
      .filter((key) => key !== "RevisionId" && key !== "LastModified")
      .map((key) => [key, readKey(value, key)]),
  );
  return storageDigest(JSON.stringify(canonical(stable)));
}

/** @param {import('./storage-transition.mjs').Writer} left
 * @param {import('./storage-transition.mjs').Writer} right
 * @param {boolean} [revision] @returns {boolean}
 */
export function sameStorageWriter(left, right, revision = true) {
  return (
    left.arn === right.arn &&
    left.logicalId === right.logicalId &&
    left.capacity === right.capacity &&
    left.timeout === right.timeout &&
    left.codeHash === right.codeHash &&
    left.configurationHash === right.configurationHash &&
    (!revision || left.revision === right.revision)
  );
}
