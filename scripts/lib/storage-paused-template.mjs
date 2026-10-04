import { parseJson, readKey, readString } from "./json.mjs";
import { StorageTransitionError, storageDigest } from "./storage-runtime.mjs";

const WRITER_ID = /^(ApiFunction|ReadModelWorker)[A-F0-9]+$/;
const WRITER_PREFIX = /^(ApiFunction|ReadModelWorker)/;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function object(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null) &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

/** Canonicalize every template field, retaining array order and metadata.
 * @param {unknown} value @returns {unknown}
 */
function canonical(value) {
  if (Array.isArray(value)) {
    if (
      Object.getOwnPropertySymbols(value).length !== 0 ||
      Object.keys(value).length !== value.length ||
      Object.keys(value).some((key, index) => key !== String(index))
    )
      throw new StorageTransitionError("paused predecessor template");
    return value.map(canonical);
  }
  if (object(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(readKey(value, key))]),
    );
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  throw new StorageTransitionError("paused predecessor template");
}

/** The previous template must preserve closed admission during rollback.
 * Return only a digest; raw templates can contain Environment values.
 * @param {unknown} response
 * @param {readonly string[]} logicalIds Actual predeployment owned storage writers.
 * @returns {string}
 */
export function assertPausedStorageTemplate(response, logicalIds) {
  try {
    if (
      !object(response) ||
      !Array.isArray(logicalIds) ||
      logicalIds.length === 0 ||
      new Set(logicalIds).size !== logicalIds.length ||
      logicalIds.some((id) => typeof id !== "string" || !WRITER_ID.test(id)) ||
      !logicalIds.some((id) => typeof id === "string" && id.startsWith("ApiFunction"))
    )
      throw new StorageTransitionError("paused predecessor template");
    const body = readKey(response, "TemplateBody");
    const template = typeof body === "string" ? parseJson(body) : body;
    const resources = readKey(template, "Resources");
    if (!object(template) || !object(resources))
      throw new StorageTransitionError("paused predecessor template");
    const expected = new Set(logicalIds);
    const seen = new Set();
    for (const [id, resource] of Object.entries(resources)) {
      if (
        !expected.has(id) &&
        (!WRITER_PREFIX.test(id) ||
          readString(resource, "Type") !== "AWS::Lambda::Function")
      )
        continue;
      const properties = readKey(resource, "Properties");
      if (
        !WRITER_ID.test(id) ||
        !expected.has(id) ||
        !object(resource) ||
        readString(resource, "Type") !== "AWS::Lambda::Function" ||
        !object(properties) ||
        readKey(properties, "ReservedConcurrentExecutions") !== 0
      )
        throw new StorageTransitionError("paused predecessor template");
      seen.add(id);
    }
    if (seen.size !== expected.size)
      throw new StorageTransitionError("paused predecessor template");
    return storageDigest(JSON.stringify(canonical(template)));
  } catch {
    throw new StorageTransitionError("paused predecessor template");
  }
}
