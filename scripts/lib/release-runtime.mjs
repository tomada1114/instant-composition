import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseJson, readKey, readString } from "./json.mjs";

/** @param {string | Uint8Array} bytes @returns {string} */
export function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export class ReleaseError extends Error {
  /** @type {"ERR_RELEASE_MISMATCH"} */
  code = "ERR_RELEASE_MISMATCH";
  /** @param {string} part */
  constructor(part) {
    super(
      `ERR_RELEASE_MISMATCH: ${part} differs from the verified release. Expected: identical SHA and bytes. Actual: mismatch. Next: rebuild and verify the release before deploying.`,
    );
    this.name = "ReleaseError";
  }
}

/** @param {unknown} value @returns {{sha: string, files: Record<string, string>}} */
export function metadata(value) {
  const sha = readString(value, "sha");
  const files = readKey(value, "files");
  if (
    sha === undefined ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    typeof files !== "object" ||
    files === null
  ) {
    throw new ReleaseError("metadata");
  }
  /** @type {Record<string, string>} */
  const checked = {};
  for (const [name, hash] of Object.entries(files)) {
    if (
      !/^[a-zA-Z0-9_./-]+$/.test(name) ||
      name.startsWith("/") ||
      name.split("/").includes("..") ||
      typeof hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(hash)
    ) {
      throw new ReleaseError("file metadata");
    }
    checked[name] = hash;
  }
  if (Object.keys(checked).length === 0) throw new ReleaseError("empty files");
  return { sha, files: checked };
}

/** @param {string} directory @param {{sha: string, files: Record<string, string>}} release @returns {void} */
export function verifyFiles(directory, release) {
  for (const [name, hash] of Object.entries(release.files)) {
    if (digest(readFileSync(path.join(directory, name))) !== hash)
      throw new ReleaseError(name);
  }
}

/**
 * Read-only deployment health: validate packaged bytes before serving any request.
 * @param {string} directory
 * @param {(event: {rawPath: string, requestContext: {http: {method: string}}}) => Promise<unknown>} next
 * @returns {(event: {rawPath: string, requestContext: {http: {method: string}}}) => Promise<unknown>}
 */
export function releaseHandler(directory, next) {
  const release = metadata(
    parseJson(readFileSync(path.join(directory, "release.json"), "utf8")),
  );
  verifyFiles(directory, release);
  return async (event) => {
    if (
      event.rawPath === "/api/release" &&
      event.requestContext.http.method === "GET"
    ) {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
        body: JSON.stringify(release),
      };
    }
    return next(event);
  };
}
