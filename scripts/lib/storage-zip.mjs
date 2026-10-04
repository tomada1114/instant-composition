import { Buffer } from "node:buffer";
import { inflateRawSync } from "node:zlib";
import { parseJson } from "./json.mjs";
import {
  guardMetadata,
  storageDigest,
  StorageTransitionError,
  verifyOuterStorageRelease,
} from "./storage-runtime.mjs";

/** No extraction, executable code or unbounded decompression while inspecting AWS's zip.
 * @param {Uint8Array} bytes @returns {Map<string,Buffer>}
 */
export function storageZipFiles(bytes) {
  const zip = Buffer.from(bytes);
  if (zip.length > 64 * 1024 * 1024 || zip.length < 22)
    throw new StorageTransitionError("zip size");
  let end = zip.length - 22;
  while (end >= Math.max(0, zip.length - 65557) && zip.readUInt32LE(end) !== 0x06054b50)
    end--;
  if (
    end < 0 ||
    zip.readUInt32LE(end) !== 0x06054b50 ||
    zip.readUInt16LE(end + 4) !== 0 ||
    zip.readUInt16LE(end + 6) !== 0 ||
    end + 22 + zip.readUInt16LE(end + 20) !== zip.length
  )
    throw new StorageTransitionError("zip end");
  const count = zip.readUInt16LE(end + 10),
    limit = zip.readUInt32LE(end + 12),
    start = zip.readUInt32LE(end + 16);
  if (count === 65535 || zip.readUInt16LE(end + 8) !== count || start + limit !== end)
    throw new StorageTransitionError("zip directory");
  /** @type {Map<string,Buffer>} */ const files = new Map();
  const names = new Set();
  /** @type {string[]} */ const directories = [];
  let offset = start,
    total = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || zip.readUInt32LE(offset) !== 0x02014b50)
      throw new StorageTransitionError("zip entry");
    const flags = zip.readUInt16LE(offset + 8),
      method = zip.readUInt16LE(offset + 10),
      compressed = zip.readUInt32LE(offset + 20),
      expanded = zip.readUInt32LE(offset + 24),
      length = zip.readUInt16LE(offset + 28),
      extra = zip.readUInt16LE(offset + 30),
      comment = zip.readUInt16LE(offset + 32),
      local = zip.readUInt32LE(offset + 42),
      kind = (zip.readUInt32LE(offset + 38) >>> 16) & 0xf000;
    if (
      offset + 46 + length + extra + comment > end ||
      (flags & 1) !== 0 ||
      (method !== 0 && method !== 8) ||
      (kind !== 0 && kind !== 0x8000 && kind !== 0x4000) ||
      expanded > 64 * 1024 * 1024 ||
      local + 30 > start ||
      zip.readUInt32LE(local) !== 0x04034b50
    )
      throw new StorageTransitionError("zip encoding");
    const name = zip.subarray(offset + 46, offset + 46 + length).toString("utf8");
    const localLength = zip.readUInt16LE(local + 26),
      localExtra = zip.readUInt16LE(local + 28),
      data = local + 30 + localLength + localExtra;
    if (
      !/^[A-Za-z0-9_./-]+$/.test(name) ||
      name.startsWith("/") ||
      name.split("/").includes("..") ||
      (kind === 0x4000 && !name.endsWith("/")) ||
      (kind === 0x8000 && name.endsWith("/")) ||
      data + compressed > start ||
      zip.subarray(local + 30, local + 30 + localLength).toString("utf8") !== name ||
      zip.readUInt16LE(local + 8) !== method ||
      names.has(name)
    )
      throw new StorageTransitionError("zip path");
    names.add(name);
    if (!name.endsWith("/")) {
      total += expanded;
      if (total > 256 * 1024 * 1024)
        throw new StorageTransitionError("zip expanded size");
      const raw = zip.subarray(data, data + compressed);
      let value;
      try {
        value =
          method === 0
            ? raw
            : inflateRawSync(raw, { maxOutputLength: Math.max(1, expanded) });
      } catch {
        throw new StorageTransitionError("zip decompression");
      }
      if (value.length !== expanded) throw new StorageTransitionError("zip length");
      files.set(name, value);
    } else directories.push(name);
    offset += 46 + length + extra + comment;
  }
  if (offset !== end) throw new StorageTransitionError("zip count");
  if (
    directories.some(
      (directory) => ![...files.keys()].some((name) => name.startsWith(directory)),
    )
  )
    throw new StorageTransitionError("unrecorded zip directory");
  return files;
}
/** AWS's CodeSha256 binds the fetched bytes; guard metadata binds every packaged file.
 * @param {Uint8Array} zip @param {string} codeSha256 @param {import('./storage-runtime.mjs').GuardMetadata} expected @returns {void}
 */
export function verifyStorageZip(zip, codeSha256, expected) {
  if (Buffer.from(storageDigest(zip), "hex").toString("base64") !== codeSha256)
    throw new StorageTransitionError("AWS code hash");
  const files = storageZipFiles(zip),
    metadata = files.get("storage-release.json");
  if (metadata === undefined) throw new StorageTransitionError("installed guard");
  const installed = guardMetadata(zipMetadata(metadata, "installed guard JSON"));
  const outer = files.get("release.json");
  if (
    !metadata.equals(Buffer.from(JSON.stringify(expected))) ||
    JSON.stringify(installed) !== JSON.stringify(expected) ||
    files.size !== Object.keys(installed.files).length + (outer === undefined ? 1 : 2)
  )
    throw new StorageTransitionError("installed release");
  for (const [name, hash] of Object.entries(installed.files)) {
    const bytes = files.get(name);
    if (bytes === undefined || storageDigest(bytes) !== hash)
      throw new StorageTransitionError("installed file");
  }
  if (outer !== undefined)
    verifyOuterStorageRelease(
      zipMetadata(outer, "outer release JSON"),
      expected.sha,
      Object.fromEntries(
        [...files]
          .filter(([name]) => name !== "release.json")
          .map(([name, bytes]) => [name, storageDigest(bytes)]),
      ),
    );
}

/** @param {Buffer} bytes @param {string} stage @returns {unknown} */
function zipMetadata(bytes, stage) {
  try {
    return parseJson(bytes.toString("utf8"));
  } catch {
    throw new StorageTransitionError(stage);
  }
}
