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
import { storageDeployJobStart } from "./lib/storage-job-budget.mjs";
import { runStorageCdk } from "./lib/storage-aws-transport.mjs";

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
/** @param {string} repository @param {string} sha @param {typeof fetch} [request] @param {number} [deadline] @returns {Promise<boolean>} */
export async function currentStorageMain(
  repository,
  sha,
  request = globalThis.fetch,
  deadline,
) {
  const token = process.env["GITHUB_TOKEN"];
  if (
    repository !== "tomada1114/instant-composition" ||
    token === undefined ||
    token === ""
  )
    throw new StorageTransitionError("main identity configuration");
  const timeout =
    deadline === undefined ? 30000 : Math.min(30000, deadline - Date.now());
  if (timeout <= 0) throw new StorageTransitionError("transition work deadline");
  let response;
  try {
    response = await request(
      `https://api.github.com/repos/${repository}/git/ref/heads/main`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
        },
        redirect: "error",
        signal: AbortSignal.timeout(timeout),
      },
    );
  } catch {
    throw new StorageTransitionError("main identity request");
  }
  if (response.status !== 200) throw new StorageTransitionError("main identity lookup");
  /** @type {unknown} */ let data;
  try {
    data = await response.json();
  } catch {
    throw new StorageTransitionError("main identity JSON");
  }
  if (deadline !== undefined && Date.now() >= deadline)
    throw new StorageTransitionError("transition work deadline");
  return readString(readKey(data, "object"), "sha") === sha;
}
/** @param {string[]} args @param {string} [root] @returns {Promise<void>} */
export async function main(
  args,
  root = fileURLToPath(new URL("../", import.meta.url)),
) {
  if (args.length === 2 && args[0] === "budget") {
    const startedAt = await storageDeployJobStart({
      repository: process.env["GITHUB_REPOSITORY"] ?? "",
      run: process.env["GITHUB_RUN_ID"] ?? "",
      attempt: process.env["GITHUB_RUN_ATTEMPT"] ?? "",
      token: process.env["GITHUB_TOKEN"] ?? "",
    });
    recordStorageJobBudget(root, Number(args[1]), Date.now(), startedAt);
    return;
  }
  if (args.length === 1 && args[0] === "evidence") {
    const evidence = storageBootstrapEvidence(root);
    if (evidence !== null) process.stdout.write(`${JSON.stringify(evidence)}\n`);
    return;
  }
  if (
    args.length === 4 &&
    args[0] === "stack" &&
    (args[3] === "foundation" || args[3] === "edge")
  ) {
    const deadline = storageJobDeadline(root);
    const assembly = args[1],
      sha = args[2];
    if (assembly === undefined || sha === undefined)
      throw new StorageTransitionError("deployment arguments");
    verifyTransitionAssembly(root, assembly, sha);
    await runStorageCdk(
      [
        "deploy",
        "--app",
        assembly,
        args[3],
        "--exclusively",
        "--require-approval",
        "never",
      ],
      root,
      deadline,
    );
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
  const deadline = mode === "deploy" ? storageJobDeadline(root) : undefined;
  const policy = preflightStorageRelease(root);
  verifyTransitionAssembly(root, assembly, sha);
  const planned = storageAssembly(assembly, sha, policy);
  await certifyRelease([policy.current], root, deadline);
  if (mode === "verify") return;
  if (roleArn === undefined || repository === undefined)
    throw new StorageTransitionError("deployment arguments");
  const current = async () =>
    currentStorageMain(repository, sha, globalThis.fetch, deadline);
  if (!(await current())) throw new StorageTransitionError("current main");
  const port = awsStorageTransition({
    root,
    assembly,
    sha,
    ...(deadline === undefined ? {} : { deadline }),
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
