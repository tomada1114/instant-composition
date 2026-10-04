import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseJson, readKey, readString } from "./lib/json.mjs";
import {
  bundleRelease,
  checkoutSha,
  manifest,
  recordRelease,
  repositoryRoot,
  smokeRelease,
  trustRun,
  isCurrentMain,
  hashes,
} from "./lib/release.mjs";
import { ReleaseError } from "./lib/release-runtime.mjs";

/** @param {string[]} args @param {string} [root] @param {typeof fetch} [request] @returns {Promise<void>} */
export async function main(args, root = repositoryRoot, request = globalThis.fetch) {
  const [command, first, second, third] = args;
  if (
    command === "trust" &&
    first !== undefined &&
    second !== undefined &&
    third !== undefined
  ) {
    trustRun(parseJson(readFileSync(first, "utf8")), second, third);
    if (checkoutSha(root) !== second) throw new ReleaseError("checkout SHA");
    return;
  }
  if (command === "current" && first !== undefined && second !== undefined) {
    const current = await isCurrentMain(
      first,
      second,
      process.env["GITHUB_TOKEN"] ?? "",
      request,
    );
    const output = process.env["GITHUB_OUTPUT"];
    if (output === undefined) throw new ReleaseError("step output path");
    appendFileSync(output, `deploy=${String(current)}\n`);
    if (!current)
      process.stdout.write(
        "Superseded CI completion: main has advanced; deployment skipped.\n",
      );
    return;
  }
  if (command === "bundle" && first !== undefined && second !== undefined) {
    bundleRelease(first, second);
  } else if (command === "web" && first !== undefined) {
    if (!/^[a-f0-9]{40}$/.test(first) || checkoutSha(root) !== first)
      throw new ReleaseError("checkout SHA");
    writeFileSync(
      path.join(root, "apps/web/dist/release.json"),
      JSON.stringify({ sha: first }),
    );
  } else if (command === "record" && first !== undefined && second !== undefined) {
    writeFileSync(
      path.join(root, "dist/release.json"),
      JSON.stringify(recordRelease(root, first, second), null, 2),
    );
  } else if (command === "verify" && first !== undefined && second !== undefined) {
    const release = manifest(
      parseJson(readFileSync(path.join(root, "dist/release.json"), "utf8")),
    );
    if (release.sha !== second || checkoutSha(root) !== second)
      throw new ReleaseError("deploy SHA");
    const current = hashes(first);
    if (
      Object.keys(current).length !== Object.keys(release.files).length ||
      Object.entries(release.files).some(([name, hash]) => current[name] !== hash)
    )
      throw new ReleaseError("assembly inventory");
  } else if (command === "smoke" && first !== undefined) {
    const outputs = parseJson(readFileSync(first, "utf8"));
    const origin = readString(
      readKey(outputs, "instant-composition-dev-app"),
      "WebUrl",
    );
    if (origin === undefined) throw new ReleaseError("WebUrl output");
    await smokeRelease(
      origin,
      manifest(parseJson(readFileSync(path.join(root, "dist/release.json"), "utf8"))),
      request,
    );
  } else throw new ReleaseError("command arguments");
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof ReleaseError ? error.message : "ERR_RELEASE_FAILED: release verification failed. Next: inspect the build and redeploy the verified assembly."}\n`,
    );
    process.exitCode = 1;
  }
}
