import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { parseJson, readKey, readString } from "./json.mjs";
import { storageRuntimeInventoryMatches } from "./storage-inventory.mjs";

export class StorageCompatibilityError extends Error {
  /** @readonly */
  code = "ERR_STORAGE_RELEASE_UNSAFE";
  /** @param {string} field */
  constructor(field) {
    super(
      `ERR_STORAGE_RELEASE_UNSAFE: Storage compatibility refused at ${field}. Expected: an explicitly fixture-certified guarded writer for every historically emitted schema. Next: use a certified release or deploy a compatible forward fix; do not roll back to an unguarded API.`,
    );
    this.name = "StorageCompatibilityError";
  }
}

/** @typedef {{current: string, emittedSchemas: number[], releases: {id: string, guarded: boolean, reads: number[], preserves: number[], writes: number, fixture: string, sha256: string, schemaFingerprint: string}[], runtimeFiles: string[]}} StoragePolicy */

/** @param {unknown} value @returns {number[]} */
function versions(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0)
  )
    throw new StorageCompatibilityError("schemas");
  return value.map((/** @type {unknown} */ item) => {
    if (typeof item !== "number") throw new StorageCompatibilityError("schemas");
    return item;
  });
}

/** Trusted current policy, never one supplied by an unguarded target binary.
 * @param {unknown} value @returns {StoragePolicy}
 */
export function storagePolicy(value) {
  const current = readString(value, "current"),
    entries = readKey(value, "releases");
  if (current === undefined || !Array.isArray(entries))
    throw new StorageCompatibilityError("policy");
  const releases = entries.map((entry) => {
    const id = readString(entry, "id"),
      fixture = readString(entry, "fixture"),
      sha256 = readString(entry, "sha256"),
      schemaFingerprint = readString(entry, "schemaFingerprint"),
      writes = readKey(entry, "writes");
    if (
      id === undefined ||
      fixture === undefined ||
      sha256 === undefined ||
      schemaFingerprint === undefined ||
      typeof writes !== "number" ||
      !Number.isSafeInteger(writes) ||
      writes < 1 ||
      !/^[a-f0-9]{64}$/.test(schemaFingerprint) ||
      !/^tests\/fixtures\/storage-[a-z0-9-]+\.json$/.test(fixture) ||
      !/^[a-f0-9]{64}$/.test(sha256) ||
      readKey(entry, "guarded") !== true
    )
      throw new StorageCompatibilityError("release");
    return {
      id,
      fixture,
      sha256,
      schemaFingerprint,
      writes,
      guarded: true,
      reads: versions(readKey(entry, "reads")),
      preserves: versions(readKey(entry, "preserves")),
    };
  });
  if (new Set(releases.map((entry) => entry.id)).size !== releases.length)
    throw new StorageCompatibilityError("releases");
  const runtimeFiles = readKey(value, "runtimeFiles");
  if (
    !Array.isArray(runtimeFiles) ||
    runtimeFiles.length === 0 ||
    !runtimeFiles.every(
      (file) =>
        typeof file === "string" &&
        /^(?:(?:packages\/(?:adapters|application|domain)|apps\/api)\/(?:src\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.tsx?|package\.json)|pnpm-lock\.yaml|package\.json)$/.test(
          file,
        ),
    )
  )
    throw new StorageCompatibilityError("runtimeFiles");
  if (new Set(runtimeFiles).size !== runtimeFiles.length)
    throw new StorageCompatibilityError("runtimeFiles");
  return {
    current,
    runtimeFiles: runtimeFiles.map((/** @type {unknown} */ file) => {
      if (typeof file !== "string") throw new StorageCompatibilityError("runtimeFiles");
      return file;
    }),
    emittedSchemas: versions(readKey(value, "emittedSchemas")),
    releases,
  };
}

/** Checks read AND lossless write compatibility before credentials/deploy/writes.
 * @param {StoragePolicy} policy @param {string} candidate @param {readonly number[]} [observed] @returns {void}
 */
export function assertStorageCompatibility(policy, candidate, observed = []) {
  const release = policy.releases.find((entry) => entry.id === candidate);
  if (
    !release?.guarded ||
    [...policy.emittedSchemas, ...observed].some(
      (schema) =>
        !release.reads.includes(schema) || !release.preserves.includes(schema),
    )
  )
    throw new StorageCompatibilityError("candidate");
}

/** Fixture hashes bind the operator ledger to the data exercised by CI.
 * @param {string} root @param {string} [candidate] @returns {StoragePolicy}
 */
export function preflightStorageRelease(root, candidate) {
  const policy = storagePolicy(
    parseJson(readFileSync(path.join(root, "storage-release-policy.json"), "utf8")),
  );
  const selected = candidate ?? policy.current;
  assertStorageCompatibility(policy, selected);
  const release = policy.releases.find((entry) => entry.id === selected);
  if (release === undefined) throw new StorageCompatibilityError("fixture");
  if (
    !policy.emittedSchemas.includes(release.writes) ||
    !release.reads.includes(release.writes) ||
    !release.preserves.includes(release.writes)
  )
    throw new StorageCompatibilityError("writer schema");
  if (
    createHash("sha256")
      .update(readFileSync(path.join(root, release.fixture)))
      .digest("hex") !== release.sha256
  )
    throw new StorageCompatibilityError("fixture");
  if (release.schemaFingerprint !== fingerprint(root, policy.runtimeFiles))
    throw new StorageCompatibilityError("runtime fingerprint");
  return policy;
}

/** @param {string} root @param {readonly string[]} files @returns {string} */
function fingerprint(root, files) {
  if (!storageRuntimeInventoryMatches(root, files))
    throw new StorageCompatibilityError("runtime inventory");
  const hash = createHash("sha256");
  for (const file of [...files].sort())
    hash
      .update(file)
      .update("\0")
      .update(readFileSync(path.join(root, file)))
      .update("\0");
  return hash.digest("hex");
}

/** Metadata is recorded inside the immutable assembly's release manifest.
 * @param {string} root @returns {{contract: string, schemaFingerprint: string}}
 */
export function storageReleaseMetadata(root) {
  const policy = storagePolicy(
    parseJson(readFileSync(path.join(root, "storage-release-policy.json"), "utf8")),
  );
  preflightStorageRelease(root, policy.current);
  return {
    contract: policy.current,
    schemaFingerprint: fingerprint(root, policy.runtimeFiles),
  };
}

/** A rollback artifact must prove which certified writer it actually contains.
 * @param {StoragePolicy} policy @param {unknown} artifact @returns {void}
 */
export function assertStorageArtifact(policy, artifact) {
  const storage = readKey(artifact, "storage"),
    contract = readString(storage, "contract"),
    hash = readString(storage, "schemaFingerprint");
  if (contract === undefined || hash === undefined)
    throw new StorageCompatibilityError("artifact storage metadata");
  assertStorageCompatibility(policy, contract);
  if (
    policy.releases.find((release) => release.id === contract)?.schemaFingerprint !==
    hash
  )
    throw new StorageCompatibilityError("artifact writer fingerprint");
}

/** Certifying a writer means executing its next write, not declaring a read range.
 * @param {unknown} fixtures @param {(row: unknown) => Promise<unknown>} writer @param {number} schemaVersion @returns {Promise<void>}
 */
export async function certifyStorageFixtures(fixtures, writer, schemaVersion) {
  if (!Array.isArray(fixtures) || fixtures.length === 0)
    throw new StorageCompatibilityError("fixture inventory");
  for (const fixture of fixtures) {
    const written = await writer(readKey(fixture, "row"));
    if (
      readKey(written, "schemaVersion") !== schemaVersion ||
      !isDeepStrictEqual(readKey(written, "value"), readKey(fixture, "expected"))
    )
      throw new StorageCompatibilityError("fixture next write");
  }
}
