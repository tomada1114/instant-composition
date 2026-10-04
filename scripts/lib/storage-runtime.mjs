import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseJson, readKey, readString } from "./json.mjs";

export class StorageTransitionError extends Error {
  /** @readonly */ code = "ERR_STORAGE_TRANSITION";
  /** @param {string} part */
  constructor(part) {
    super(
      `ERR_STORAGE_TRANSITION: Admission refused at ${part}. Expected: paused owned writers running identical certified bytes. Next: keep writers paused and deploy a compatible forward fix.`,
    );
    this.name = "StorageTransitionError";
    this.part = part;
  }
  /** The fixed check name; never AWS response text or a signed URL. @readonly @type {string} */
  part;
}
/** @param {string | Uint8Array} bytes @returns {string} */
export function storageDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
/** @typedef {{sha: string, storage: {contract: string, schemaFingerprint: string}, files: Record<string,string>}} GuardMetadata */
/** @param {unknown} value @returns {GuardMetadata} */
export function guardMetadata(value) {
  const sha = readString(value, "sha"),
    storage = readKey(value, "storage"),
    contract = readString(storage, "contract"),
    schemaFingerprint = readString(storage, "schemaFingerprint"),
    files = readKey(value, "files");
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "files,sha,storage" ||
    typeof storage !== "object" ||
    storage === null ||
    Array.isArray(storage) ||
    Object.keys(storage).sort().join(",") !== "contract,schemaFingerprint" ||
    sha === undefined ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    contract === undefined ||
    schemaFingerprint === undefined ||
    !/^[a-f0-9]{64}$/.test(schemaFingerprint) ||
    typeof files !== "object" ||
    files === null ||
    Array.isArray(files)
  )
    throw new StorageTransitionError("guard metadata");
  /** @type {Map<string,string>} */ const checked = new Map();
  for (const [name, hash] of Object.entries(files)) {
    if (
      !/^[A-Za-z0-9_./-]+$/.test(name) ||
      name.startsWith("/") ||
      name.split("/").some((part) => part === ".." || part === "") ||
      name === "storage-release.json" ||
      name === "release.json" ||
      typeof hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(hash)
    )
      throw new StorageTransitionError("guard files");
    checked.set(name, hash);
  }
  if (!checked.has("index.mjs") || !checked.has("storage.mjs"))
    throw new StorageTransitionError("guard entry");
  return {
    sha,
    storage: { contract, schemaFingerprint },
    files: Object.fromEntries(checked),
  };
}
/** Every file must be declared with identical bytes; JSON key order is immaterial.
 * @param {unknown} files @param {Readonly<Record<string,string>>} expected @returns {boolean}
 */
export function storageInventoryMatches(files, expected) {
  return (
    typeof files === "object" &&
    files !== null &&
    !Array.isArray(files) &&
    Object.keys(files).length === Object.keys(expected).length &&
    Object.entries(expected).every(([name, hash]) => readString(files, name) === hash)
  );
}
/** Outer #441 manifest owns all files except itself, including the storage manifest.
 * @param {unknown} value @param {string} sha @param {Readonly<Record<string,string>>} expected @returns {void}
 */
export function verifyOuterStorageRelease(value, sha, expected) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "files,sha" ||
    readString(value, "sha") !== sha ||
    !storageInventoryMatches(readKey(value, "files"), expected)
  )
    throw new StorageTransitionError("outer release identity");
}
/** @param {string} root @returns {Record<string,string>} */
export function storageHashes(root) {
  /** @type {Map<string,string>} */ const files = new Map();
  /** @param {string} relative */ function visit(relative) {
    for (const entry of readdirSync(path.join(root, relative), {
      withFileTypes: true,
    }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new StorageTransitionError("symlink");
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile())
        files.set(name, storageDigest(readFileSync(path.join(root, name))));
      else throw new StorageTransitionError("non-file input");
    }
  }
  visit("");
  return Object.fromEntries(files);
}
/** A dedicated read-only probe works for HTTP and scheduler Lambdas.
 * The optional second context preserves Lambda fields and carries only verified
 * guard metadata. Event-supplied identities never override this release binding.
 * @param {string} directory @param {(event: unknown, context?: unknown) => Promise<unknown>} next @returns {(event:unknown, context?:unknown) => Promise<unknown>}
 */
export function storageHandler(directory, next) {
  const release = guardMetadata(
    parseJson(readFileSync(path.join(directory, "storage-release.json"), "utf8")),
  );
  const actual = storageHashes(directory);
  if ("release.json" in actual) {
    delete actual["release.json"];
    verifyOuterStorageRelease(
      parseJson(readFileSync(path.join(directory, "release.json"), "utf8")),
      release.sha,
      actual,
    );
  }
  delete actual["storage-release.json"];
  if (!storageInventoryMatches(actual, release.files))
    throw new StorageTransitionError("packaged bytes");
  const storageRelease = Object.freeze({ sha: release.sha, ...release.storage });
  return async (event, context) =>
    readKey(event, "storageReleaseProbe") === true
      ? release
      : next(event, {
          ...(typeof context === "object" && context !== null ? context : {}),
          storageRelease,
        });
}
