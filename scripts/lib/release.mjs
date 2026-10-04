import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isolatedGitEnv } from "./git-env.mjs";
import { parseJson, readKey, readString } from "./json.mjs";
import { digest, metadata, ReleaseError, verifyFiles } from "./release-runtime.mjs";

/** @param {string} root @returns {Record<string, string>} */
export function hashes(root) {
  /** @type {Map<string, string>} */
  const files = new Map();
  /** @param {string} relative */
  function visit(relative) {
    for (const entry of readdirSync(path.join(root, relative), {
      withFileTypes: true,
    }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new ReleaseError("symlink");
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile())
        files.set(name, digest(readFileSync(path.join(root, name))));
      else throw new ReleaseError("non-file input");
    }
  }
  visit("");
  return Object.fromEntries(files);
}

/** @param {string} root @returns {string} */
export function checkoutSha(root) {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    env: isolatedGitEnv(),
    encoding: "utf8",
  }).trim();
}

/** @param {string} root @param {string} output @returns {void} */
export function bundleRelease(root, output) {
  const helper = path.join(output, "release-lib");
  mkdirSync(helper, { recursive: true });
  for (const name of ["release-runtime.mjs", "json.mjs"])
    copyFileSync(path.join(root, "scripts/lib", name), path.join(helper, name));
  writeFileSync(
    path.join(output, "release.mjs"),
    `import { fileURLToPath } from "node:url";
import { handler as next } from "./index.mjs";
import { releaseHandler } from "./release-lib/release-runtime.mjs";
export const handler = releaseHandler(fileURLToPath(new URL(".", import.meta.url)), next);
`,
  );
  const files = hashes(output);
  delete files["release.json"];
  writeFileSync(
    path.join(output, "release.json"),
    JSON.stringify({ sha: checkoutSha(root), files }),
  );
}

/** @param {string} root @param {string} assembly @param {string} sha @returns {{sha: string, files: Record<string, string>, web: {sha: string, files: Record<string, string>}, api: {sha: string, files: Record<string, string>}}} */
export function recordRelease(root, assembly, sha) {
  if (checkoutSha(root) !== sha) throw new ReleaseError("checkout SHA");
  const candidates = readdirSync(assembly)
    .filter((name) => name.startsWith("asset."))
    .flatMap((name) => {
      const directory = path.join(assembly, name);
      return statSync(directory).isDirectory() &&
        readdirSync(directory).includes("release.json") &&
        readdirSync(directory).includes("index.mjs")
        ? [directory]
        : [];
    });
  if (candidates.length !== 1 || candidates[0] === undefined)
    throw new ReleaseError("API bundle count");
  const api = metadata(
    parseJson(readFileSync(path.join(candidates[0], "release.json"), "utf8")),
  );
  const webDir = path.join(root, "apps/web/dist");
  if (
    api.sha !== sha ||
    readString(
      parseJson(readFileSync(path.join(webDir, "release.json"), "utf8")),
      "sha",
    ) !== sha
  )
    throw new ReleaseError("build SHA");
  verifyFiles(candidates[0], api);
  const webAssets = readdirSync(assembly)
    .filter((name) => name.startsWith("asset."))
    .map((name) => path.join(assembly, name))
    .filter(
      (directory) =>
        statSync(directory).isDirectory() &&
        readdirSync(directory).includes("index.html"),
    );
  if (
    webAssets.length !== 1 ||
    webAssets[0] === undefined ||
    JSON.stringify(hashes(webAssets[0])) !== JSON.stringify(hashes(webDir))
  )
    throw new ReleaseError("assembled web bytes");
  return { sha, files: hashes(assembly), web: { sha, files: hashes(webDir) }, api };
}

/** @param {unknown} value @returns {{sha: string, files: Record<string, string>, web: {sha: string, files: Record<string, string>}, api: {sha: string, files: Record<string, string>}}} */
export function manifest(value) {
  const release = metadata(value);
  const web = metadata(readKey(value, "web"));
  const api = metadata(readKey(value, "api"));
  if (web.sha !== release.sha || api.sha !== release.sha)
    throw new ReleaseError("component SHA");
  return { ...release, web, api };
}

/** @param {string} origin @param {ReturnType<typeof manifest>} release @param {typeof fetch} request @returns {Promise<void>} */
export async function smokeRelease(origin, release, request = globalThis.fetch) {
  const base = new URL(origin);
  if (
    base.protocol !== "https:" ||
    base.pathname !== "/" ||
    base.username !== "" ||
    base.password !== "" ||
    base.search !== "" ||
    base.hash !== ""
  )
    throw new ReleaseError("CloudFront origin");
  /** @param {string} name @param {number} status */
  async function get(name, status) {
    const response = await request(new URL(name, base), {
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: { "cache-control": "no-cache" },
    });
    if (response.status !== status) throw new ReleaseError(`HTTP ${name}`);
    return response;
  }
  for (const [name, hash] of Object.entries(release.web.files)) {
    if (digest(new Uint8Array(await (await get(name, 200)).arrayBuffer())) !== hash)
      throw new ReleaseError(`web ${name}`);
  }
  const route = await get("records", 200);
  if (
    digest(new Uint8Array(await route.arrayBuffer())) !==
    readString(release.web.files, "index.html")
  )
    throw new ReleaseError("SPA route");
  const api = metadata(await (await get("api/release", 200)).json());
  if (
    api.sha !== release.sha ||
    JSON.stringify(api.files) !== JSON.stringify(release.api.files)
  )
    throw new ReleaseError("served API/catalog");
  /** @type {unknown} */
  const refusal = await (await get("api/v1/home", 401)).json();
  if (readString(readKey(refusal, "error"), "code") !== "ERR_UNAUTHENTICATED")
    throw new ReleaseError("unauthenticated contract");
}

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

/** @param {unknown} event @param {string} sha @param {string} repository @returns {void} */
export function trustRun(event, sha, repository) {
  const run = readKey(event, "workflow_run");
  if (
    readString(event, "action") !== "completed" ||
    readString(run, "status") !== "completed" ||
    readString(run, "conclusion") !== "success" ||
    readString(run, "event") !== "push" ||
    readString(run, "head_branch") !== "main" ||
    readString(run, "head_sha") !== sha ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    readString(run, "path") !== ".github/workflows/ci.yml" ||
    readString(readKey(run, "head_repository"), "full_name") !== repository
  )
    throw new ReleaseError("trusted CI completion");
}

/** @param {string} repository @param {string} sha @param {string} token @param {typeof fetch} request @returns {Promise<boolean>} */
export async function isCurrentMain(
  repository,
  sha,
  token,
  request = globalThis.fetch,
) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || token === "")
    throw new ReleaseError("main guard configuration");
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
  if (response.status !== 200) throw new ReleaseError("current main lookup");
  /** @type {unknown} */
  const body = await response.json();
  const current = readString(readKey(body, "object"), "sha");
  if (current === undefined || !/^[a-f0-9]{40}$/.test(current))
    throw new ReleaseError("current main response");
  return current === sha;
}
