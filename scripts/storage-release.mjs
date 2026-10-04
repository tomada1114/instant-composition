import { readFileSync } from "node:fs";
import { parseJson, readKey } from "./lib/json.mjs";
import path from "node:path";
import { createStorageValidator } from "./lib/storage-validator.mjs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertStorageArtifact,
  certifyStorageFixtures,
  preflightStorageRelease,
  StorageCompatibilityError,
} from "./lib/storage-compatibility.mjs";

/** @param {string[]} args @param {string} [root] @returns {Promise<void>} */
export async function main(
  args,
  root = fileURLToPath(new URL("../", import.meta.url)),
) {
  const [candidate, artifact] = args;
  if ((args.length !== 1 && args.length !== 2) || candidate === undefined)
    throw new StorageCompatibilityError("arguments");
  const policy = preflightStorageRelease(
    root,
    candidate === "current" ? undefined : candidate,
  );
  if (artifact !== undefined)
    assertStorageArtifact(policy, parseJson(readFileSync(artifact, "utf8")));
  const release = policy.releases.find(
    (entry) => entry.id === (candidate === "current" ? policy.current : candidate),
  );
  if (release === undefined) throw new StorageCompatibilityError("candidate");
  const document = parseJson(readFileSync(path.join(root, release.fixture), "utf8"));
  if (
    readKey(document, "contract") !== release.id ||
    readKey(document, "schemaVersion") !== release.writes
  )
    throw new StorageCompatibilityError("fixture contract/schema");
  const fixtures = readKey(document, "fixtures");
  const validator = createStorageValidator();
  try {
    await certifyStorageFixtures(
      fixtures,
      async (row) => {
        const records = readKey(await validator.request([row]), "rows");
        if (!Array.isArray(records))
          throw new StorageCompatibilityError("runtime decoder");
        /** @type {unknown} */ const decoded = records[0];
        return {
          schemaVersion: readKey(decoded, "targetSchema"),
          value: readKey(decoded, "targetValue"),
        };
      },
      release.writes,
    );
  } finally {
    await validator.close();
  }
}
if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof StorageCompatibilityError ? error.message : "ERR_STORAGE_RELEASE_UNSAFE: Missing trusted storage policy. Expected: reviewed current release ledger. Next: restore policy and deploy a compatible forward fix."}\n`,
    );
    process.exitCode = 1;
  }
}
