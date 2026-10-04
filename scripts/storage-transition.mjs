import process from "node:process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main as certifyRelease } from "./storage-release.mjs";
import { preflightStorageRelease } from "./lib/storage-compatibility.mjs";
import { storageAssembly } from "./lib/storage-assembly.mjs";
import { awsStorageTransition } from "./lib/storage-aws.mjs";
import { transitionStorageWriters } from "./lib/storage-transition.mjs";
import {
  storageBootstrapEvidence,
  recordStorageJobBudget,
  storageJobDeadline,
} from "./lib/storage-bootstrap.mjs";
import { parseJson, readKey, readString } from "./lib/json.mjs";
import { storageHashes, StorageTransitionError } from "./lib/storage-runtime.mjs";

/** @param {string} root @param {string} assembly @param {string} sha @returns {void} */
export function verifyTransitionAssembly(root, assembly, sha) {
  const release = parseJson(readFileSync(path.join(root, "dist/release.json"), "utf8"));
  if (
    readString(release, "sha") !== sha ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    JSON.stringify(readKey(release, "files")) !==
      JSON.stringify(storageHashes(assembly))
  )
    throw new StorageTransitionError("immutable assembly identity");
}
/** @param {string} repository @param {string} sha @param {typeof fetch} [request] @returns {Promise<boolean>} */
export async function currentStorageMain(repository, sha, request = globalThis.fetch) {
  const token = process.env["GITHUB_TOKEN"];
  if (
    repository !== "tomada1114/instant-composition" ||
    token === undefined ||
    token === ""
  )
    throw new StorageTransitionError("main identity configuration");
  const response = await request(
    `https://api.github.com/repos/${repository}/git/ref/heads/main`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  if (response.status !== 200) throw new StorageTransitionError("main identity lookup");
  /** @type {unknown} */ const data = await response.json();
  return readString(readKey(data, "object"), "sha") === sha;
}
/** @param {string[]} args @param {string} [root] @returns {Promise<void>} */
export async function main(
  args,
  root = fileURLToPath(new URL("../", import.meta.url)),
) {
  if (args.length === 2 && args[0] === "budget") {
    recordStorageJobBudget(root, Number(args[1]));
    return;
  }
  if (args.length === 1 && args[0] === "evidence") {
    const evidence = storageBootstrapEvidence(root);
    if (evidence !== null) process.stdout.write(`${JSON.stringify(evidence)}\n`);
    return;
  }
  const [mode, assembly, sha, roleArn, repository] = args;
  if (
    (mode !== "verify" && mode !== "deploy") ||
    assembly === undefined ||
    sha === undefined ||
    (mode === "verify" ? args.length !== 3 : args.length !== 5)
  )
    throw new StorageTransitionError("arguments");
  const policy = preflightStorageRelease(root);
  verifyTransitionAssembly(root, assembly, sha);
  const planned = storageAssembly(assembly, sha, policy);
  await certifyRelease([policy.current], root);
  if (mode === "verify") return;
  if (roleArn === undefined || repository === undefined)
    throw new StorageTransitionError("deployment arguments");
  const current = async () => currentStorageMain(repository, sha);
  if (!(await current())) throw new StorageTransitionError("current main");
  const port = awsStorageTransition({
    root,
    assembly,
    sha,
    deadline: storageJobDeadline(root),
    roleArn,
    policy,
    planned,
    current,
  });
  await transitionStorageWriters({
    ...port,
    deploy: async () => {
      verifyTransitionAssembly(root, assembly, sha);
      await port.deploy();
    },
  });
}
if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof StorageTransitionError ? error.message : "ERR_STORAGE_TRANSITION: Unexpected failure; inspect dist/storage-transition.json and deploy a compatible forward fix."}\n`,
    );
    process.exitCode = 1;
  }
}
