import process from "node:process";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { storageReleaseMetadata } from "./lib/storage-compatibility.mjs";
import { storageHashes, StorageTransitionError } from "./lib/storage-runtime.mjs";
import { isolatedGitEnv } from "./lib/git-env.mjs";

/** Guard wraps the final release handler, including scheduler bundles.
 * @param {string} root @param {string} output @returns {void}
 */
export function bundleStorageGuard(root, output) {
  const storage = storageReleaseMetadata(root);
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    env: isolatedGitEnv(),
    encoding: "utf8",
  }).trim();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new StorageTransitionError("checkout SHA");
  const helper = path.join(output, "storage-lib");
  mkdirSync(helper, { recursive: true });
  for (const name of ["json.mjs", "storage-runtime.mjs"])
    copyFileSync(path.join(root, "scripts/lib", name), path.join(helper, name));
  const entry = existsSync(path.join(output, "release.mjs"))
    ? "release.mjs"
    : "index.mjs";
  writeFileSync(
    path.join(output, "storage.mjs"),
    `import { fileURLToPath } from "node:url";\nimport { handler as next } from "./${entry}";\nimport { storageHandler } from "./storage-lib/storage-runtime.mjs";\nexport const handler = storageHandler(fileURLToPath(new URL(".", import.meta.url)), next);\n`,
  );
  const files = storageHashes(output);
  delete files["storage-release.json"];
  // The outer manifest is refreshed after this guard; mutually hashing manifests
  // would be circular. Runtime and ZIP certification separately verify its full inventory.
  delete files["release.json"];
  writeFileSync(
    path.join(output, "storage-release.json"),
    JSON.stringify({ sha, storage, files }),
  );
}
if (import.meta.main) {
  try {
    const [root, output] = process.argv.slice(2);
    if (root === undefined || output === undefined)
      throw new StorageTransitionError("bundle arguments");
    bundleStorageGuard(root, output);
  } catch {
    process.stderr.write("ERR_STORAGE_TRANSITION: Guard bundling refused.\n");
    process.exitCode = 1;
  }
}
