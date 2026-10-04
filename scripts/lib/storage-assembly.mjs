import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseJson, readKey, readString } from "./json.mjs";
import { assertStorageArtifact } from "./storage-compatibility.mjs";
import {
  guardMetadata,
  storageHashes,
  StorageTransitionError,
  storageInventoryMatches,
  verifyOuterStorageRelease,
} from "./storage-runtime.mjs";

/** @typedef {{logicalId:string, capacity:number|null, timeout:number, release:import('./storage-runtime.mjs').GuardMetadata}} PlannedWriter */
/** @param {string} assembly @param {string} sha @param {import('./storage-compatibility.mjs').StoragePolicy} policy @returns {PlannedWriter[]} */
export function storageAssembly(assembly, sha, policy) {
  const artifact = parseJson(
    readFileSync(path.join(assembly, "manifest.json"), "utf8"),
  );
  const app = readKey(readKey(artifact, "artifacts"), "app");
  if (
    readString(app, "type") !== "aws:cloudformation:stack" ||
    readString(readKey(app, "properties"), "stackName") !==
      "instant-composition-dev-app"
  )
    throw new StorageTransitionError("owned assembly stack");
  const name = readString(readKey(app, "properties"), "templateFile");
  if (name === undefined || !/^[A-Za-z0-9.-]+\.json$/.test(name))
    throw new StorageTransitionError("template path");
  const resources = readKey(
    parseJson(readFileSync(path.join(assembly, name), "utf8")),
    "Resources",
  );
  if (typeof resources !== "object" || resources === null)
    throw new StorageTransitionError("template resources");
  const bundles = readdirSync(assembly)
    .filter((entry) => /^asset\.[a-f0-9]+$/.test(entry))
    .flatMap((entry) => {
      try {
        return [
          {
            name: entry,
            release: guardMetadata(
              parseJson(
                readFileSync(
                  path.join(assembly, entry, "storage-release.json"),
                  "utf8",
                ),
              ),
            ),
          },
        ];
      } catch {
        return [];
      }
    });
  /** @type {PlannedWriter[]} */ const writers = [];
  for (const [logicalId, resource] of Object.entries(resources)) {
    if (
      readString(resource, "Type") !== "AWS::Lambda::Function" ||
      !/^(ApiFunction|ReadModelWorker)[A-F0-9]+$/.test(logicalId)
    )
      continue;
    const props = readKey(resource, "Properties"),
      metadata = readKey(resource, "Metadata"),
      asset = readString(metadata, "aws:asset:path"),
      capacity = readKey(metadata, "instant-composition:storage-capacity"),
      timeout = readKey(props, "Timeout");
    const bundle = bundles.find((entry) => entry.name === asset);
    if (
      readString(props, "Handler") !== "storage.handler" ||
      readKey(props, "ReservedConcurrentExecutions") !== 0 ||
      (capacity !== "unreserved" && capacity !== 1) ||
      typeof timeout !== "number" ||
      timeout < 1 ||
      timeout > 900 ||
      bundle?.release.sha !== sha
    )
      throw new StorageTransitionError("paused writer template");
    assertStorageArtifact(policy, bundle.release);
    const actual = storageHashes(path.join(assembly, bundle.name));
    if ("release.json" in actual) {
      delete actual["release.json"];
      verifyOuterStorageRelease(
        parseJson(
          readFileSync(path.join(assembly, bundle.name, "release.json"), "utf8"),
        ),
        sha,
        actual,
      );
    }
    delete actual["storage-release.json"];
    if (!storageInventoryMatches(actual, bundle.release.files))
      throw new StorageTransitionError("assembled writer bytes");
    writers.push({
      logicalId,
      capacity: capacity === "unreserved" ? null : 1,
      timeout,
      release: bundle.release,
    });
  }
  if (
    writers.length < 1 ||
    writers.length > 2 ||
    !writers.some((writer) => writer.logicalId.startsWith("ApiFunction")) ||
    bundles.length !== writers.length
  )
    throw new StorageTransitionError("writer inventory");
  return writers;
}
