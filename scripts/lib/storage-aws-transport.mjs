import { Buffer } from "node:buffer";
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout, clearTimeout } from "node:timers";
import { parseJson, readKey, readString } from "./json.mjs";
import { StorageTransitionError } from "./storage-runtime.mjs";

/** @param {number} limit @param {number} [deadline] @returns {number} */
function commandTime(limit, deadline) {
  const remaining = deadline === undefined ? limit : deadline - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0)
    throw new StorageTransitionError("transition work deadline");
  return Math.min(limit, remaining);
}
/** @param {string[]} args @param {NodeJS.ProcessEnv} env @param {number} [deadline] @returns {unknown} */
export function awsJson(args, env, deadline) {
  const timeout = commandTime(60000, deadline);
  try {
    return parseJson(
      execFileSync("aws", [...args, "--region", "ap-northeast-1", "--output", "json"], {
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 8 * 1024 * 1024,
        timeout,
        killSignal: "SIGKILL",
      }) || "null",
    );
  } catch (error) {
    const operation = args.slice(0, 2).join(" ");
    const owned = [
      "sts get-caller-identity",
      "sts assume-role",
      "cloudformation list-stack-resources",
      "cloudformation describe-stacks",
      "cloudformation get-template",
      "lambda get-function",
      "lambda get-function-configuration",
      "lambda get-function-concurrency",
      "lambda put-function-concurrency",
      "lambda delete-function-concurrency",
    ].includes(operation);
    const stderr =
      error instanceof Error && "stderr" in error ? String(error.stderr) : "";
    const outcome = [
      "AccessDeniedException",
      "ResourceConflictException",
      "ThrottlingException",
      "TooManyRequestsException",
      "ExpiredToken",
      "UnrecognizedClientException",
      "ResourceNotFoundException",
      "InvalidParameterValueException",
    ].find((code) => stderr.includes(code));
    throw new StorageTransitionError(
      owned
        ? `AWS ${operation}${outcome === undefined ? "" : ` ${outcome}`}`
        : "AWS operation",
    );
  }
}
/** Stop and reap the whole local CLI group; an accepted paused-template CFN update may continue.
 * @param {string[]} args @param {string} root @param {number} [deadline] @returns {Promise<void>}
 */
export function runStorageCdk(args, root, deadline) {
  const timeout = commandTime(30 * 60000, deadline);
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["cdk", ...args], {
      cwd: root,
      stdio: "inherit",
      detached: true,
    });
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      } else child.kill("SIGKILL");
    }, timeout);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new StorageTransitionError("CDK execution"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && !expired) resolve();
      else
        reject(
          new StorageTransitionError(
            expired ? "transition work deadline" : "CDK deployment",
          ),
        );
    });
  });
}
/** Only closed diagnostic categories may leave this boundary.
 * @param {unknown} error @returns {"TimeoutError" | "AbortError" | "TypeError" | "Error" | "unknown"}
 */
function downloadCategory(error) {
  const name = readString(error, "name");
  switch (name) {
    case "TimeoutError":
    case "AbortError":
    case "TypeError":
    case "Error":
      return name;
    default:
      return "unknown";
  }
}
/** @param {unknown} error @returns {boolean} */
function transientDownload(error) {
  const allowed = ["EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"];
  return [readString(error, "code"), readString(readKey(error, "cause"), "code")].some(
    (code) => code !== undefined && allowed.includes(code),
  );
}
/** @param {unknown} result @param {number} [deadline] @returns {Promise<Buffer>} */
export async function deployedStorageZip(result, deadline) {
  const startedAt = Date.now();
  const timeout = commandTime(30000, deadline);
  const expiresAt = Math.min(startedAt + timeout, deadline ?? Infinity);
  const locationText = readString(readKey(result, "Code"), "Location");
  if (locationText === undefined) throw new StorageTransitionError("AWS code location");
  let location;
  try {
    location = new URL(locationText);
  } catch (error) {
    throw new StorageTransitionError(`AWS code location ${downloadCategory(error)}`);
  }
  if (
    location.protocol !== "https:" ||
    !location.hostname.endsWith(".amazonaws.com") ||
    location.username !== "" ||
    location.password !== ""
  )
    throw new StorageTransitionError("AWS code location");
  const controller = new AbortController();
  const expired = new StorageTransitionError("AWS code download TimeoutError");
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {Promise<never>} */
  const expiry = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => {
        controller.abort(expired);
        reject(expired);
      },
      Math.max(0, expiresAt - Date.now()),
    );
  });
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (Date.now() >= expiresAt) throw expired;
      let part = "AWS code fetch";
      try {
        const response = await Promise.race([
          globalThis.fetch(location, { redirect: "error", signal: controller.signal }),
          expiry,
        ]);
        if (Date.now() >= expiresAt) throw expired;
        if (
          !response.ok ||
          Number(response.headers.get("content-length")) > 64 * 1024 * 1024
        )
          throw new StorageTransitionError("AWS code download");
        part = "AWS code body";
        const zip = Buffer.from(await Promise.race([response.arrayBuffer(), expiry]));
        if (Date.now() >= expiresAt) throw expired;
        if (zip.length > 64 * 1024 * 1024)
          throw new StorageTransitionError("AWS code size");
        return zip;
      } catch (error) {
        if (error instanceof StorageTransitionError) throw error;
        if (Date.now() >= expiresAt) throw expired;
        if (attempt !== 0 || !transientDownload(error) || expiresAt - Date.now() <= 100)
          throw new StorageTransitionError(`${part} ${downloadCategory(error)}`);
        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let backoff;
        try {
          await Promise.race([
            new Promise((resolve) => {
              backoff = setTimeout(resolve, 100);
            }),
            expiry,
          ]);
        } finally {
          clearTimeout(backoff);
        }
      }
    }
    throw new StorageTransitionError("AWS code download");
  } finally {
    clearTimeout(timer);
    if (!controller.signal.aborted)
      controller.abort(new StorageTransitionError("AWS code download"));
  }
}
/** @param {string} arn @param {string} root @param {number} [deadline] @returns {Promise<boolean>} */
export function probeStorageThrottle(arn, root, deadline) {
  const timeout = commandTime(30000, deadline);
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
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout,
        killSignal: "SIGKILL",
      },
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
 * @param {string} arn @param {string} root @param {string|null} checkpoint @param {number} [deadline] @returns {Promise<unknown>}
 */
export async function invokeStorageBootstrap(arn, root, checkpoint, deadline) {
  const timeout = commandTime(65000, deadline);
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
        { stdio: ["ignore", "pipe", "pipe"], timeout, killSignal: "SIGKILL" },
      );
      let output = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (/** @type {string} */ chunk) => {
        output += chunk;
        if (output.length > 8192) child.kill("SIGKILL");
      });
      child.stderr.resume();
      child.once("error", () => {
        reject(new StorageTransitionError("bootstrap invoke outcome"));
      });
      child.once("close", (code) => {
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
