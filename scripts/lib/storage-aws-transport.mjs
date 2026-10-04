import { Buffer } from "node:buffer";
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { parseJson, readKey, readString } from "./json.mjs";
import { StorageTransitionError } from "./storage-runtime.mjs";

/** @param {string[]} args @param {NodeJS.ProcessEnv} env @returns {unknown} */
export function awsJson(args, env) {
  try {
    return parseJson(
      execFileSync("aws", [...args, "--region", "ap-northeast-1", "--output", "json"], {
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 8 * 1024 * 1024,
        timeout: 60000,
      }) || "null",
    );
  } catch {
    throw new StorageTransitionError("AWS operation");
  }
}
/** @param {string[]} args @param {string} root @returns {Promise<void>} */
export function runStorageCdk(args, root) {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["cdk", ...args], { cwd: root, stdio: "inherit" });
    child.once("error", () => {
      reject(new StorageTransitionError("CDK execution"));
    });
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new StorageTransitionError("CDK deployment"));
    });
  });
}
/** @param {unknown} result @returns {Promise<Buffer>} */
export async function deployedStorageZip(result) {
  const locationText = readString(readKey(result, "Code"), "Location");
  if (locationText === undefined) throw new StorageTransitionError("AWS code location");
  const location = new URL(locationText);
  if (
    location.protocol !== "https:" ||
    !location.hostname.endsWith(".amazonaws.com") ||
    location.username !== "" ||
    location.password !== ""
  )
    throw new StorageTransitionError("AWS code location");
  const response = await globalThis.fetch(location, {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok || Number(response.headers.get("content-length")) > 64 * 1024 * 1024)
    throw new StorageTransitionError("AWS code download");
  const zip = Buffer.from(await response.arrayBuffer());
  if (zip.length > 64 * 1024 * 1024) throw new StorageTransitionError("AWS code size");
  return zip;
}
/** @param {string} arn @param {string} root @returns {Promise<boolean>} */
export function probeStorageThrottle(arn, root) {
  try {
    execFileSync(
      "aws",
      [
        "lambda",
        "invoke",
        "--function-name",
        arn,
        "--invocation-type",
        "RequestResponse",
        "--cli-binary-format",
        "raw-in-base64-out",
        "--payload",
        '{"storageReleaseProbe":true}',
        "--region",
        "ap-northeast-1",
        path.join(root, "dist/storage-probe.json"),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 },
    );
    return Promise.resolve(false);
  } catch (error) {
    return Promise.resolve(
      error instanceof Error &&
        "stderr" in error &&
        String(error.stderr).includes("TooManyRequestsException"),
    );
  }
}

/** Payloads stay in private files; no learner key enters a command argument or log.
 * @param {string} arn @param {string} root @param {string|null} checkpoint @returns {Promise<unknown>}
 */
export async function invokeStorageBootstrap(arn, root, checkpoint) {
  const request = path.join(root, "dist/storage-bootstrap-request.json"),
    response = path.join(root, "dist/storage-bootstrap-response.json");
  writeFileSync(request, JSON.stringify({ storageBootstrap: true, checkpoint }), {
    mode: 0o600,
  });
  writeFileSync(response, "", { mode: 0o600 });
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        "aws",
        [
          "lambda",
          "invoke",
          "--function-name",
          arn,
          "--invocation-type",
          "RequestResponse",
          "--payload",
          `fileb://${request}`,
          "--region",
          "ap-northeast-1",
          response,
        ],
        { stdio: ["ignore", "pipe", "pipe"], timeout: 65000 },
      );
      let output = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (/** @type {string} */ chunk) => {
        output += chunk;
        if (output.length > 8192) child.kill();
      });
      child.stderr.resume();
      child.once("error", () => {
        reject(new StorageTransitionError("bootstrap invoke outcome"));
      });
      child.once("exit", (code) => {
        try {
          const status = parseJson(output);
          if (
            code !== 0 ||
            output.length > 8192 ||
            readKey(status, "StatusCode") !== 200 ||
            readKey(status, "FunctionError") !== undefined
          )
            throw new StorageTransitionError("bootstrap invoke outcome");
          resolve(undefined);
        } catch {
          reject(new StorageTransitionError("bootstrap invoke outcome"));
        }
      });
    });
    const encoded = readFileSync(response, "utf8");
    if (Buffer.byteLength(encoded) > 16384)
      throw new StorageTransitionError("bootstrap invoke outcome");
    return parseJson(encoded);
  } catch {
    throw new StorageTransitionError("bootstrap invoke outcome");
  } finally {
    unlinkSync(request);
  }
}
