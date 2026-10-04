import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseJson, readKey } from "./json.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

/** @typedef {{request: (input: unknown) => Promise<unknown>, close: () => Promise<void>}} StorageValidator */
/** @returns {Error} */
function refusal() {
  return new Error(
    "ERR_STORAGE_VALIDATOR_REFUSED: Maintenance request refused. Expected: Node 24, installed dependencies and supported storage shapes. Next: inspect compatibility and resume with a compatible forward fix.",
  );
}

/** Installed program owns all decoding and SDK operations. Bodies never enter
 * arguments or logs; one process serves bounded requests without repeated startup.
 * @param {string | undefined} [profile] @returns {StorageValidator}
 */
export function createStorageValidator(profile) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      path.join(root, "scripts/ts-hooks.mjs"),
      path.join(root, "apps/api/src/storage-maintenance-main.ts"),
    ],
    {
      cwd: root,
      stdio: ["pipe", "pipe", "ignore"],
      env: {
        ...process.env,
        ...(profile === undefined ? {} : { AWS_PROFILE: profile }),
        AWS_EC2_METADATA_DISABLED: "true",
      },
    },
  );
  /** @type {{resolve: (answer: unknown) => void, reject: (error: Error) => void} | undefined} */
  let pending;
  let output = "",
    stopped = false;
  child.stdin.on("error", () => {
    pending?.reject(refusal());
    pending = undefined;
  });
  child.on("error", () => {
    stopped = true;
    pending?.reject(refusal());
    pending = undefined;
  });
  child.on("close", () => {
    stopped = true;
    pending?.reject(refusal());
    pending = undefined;
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (/** @type {string} */ chunk) => {
    output += chunk;
    if (output.length > 8 * 1024 * 1024) {
      child.kill();
      return;
    }
    const newline = output.indexOf("\n");
    if (newline < 0) return;
    const response = output.slice(0, newline);
    output = output.slice(newline + 1);
    const waiting = pending;
    pending = undefined;
    try {
      const answer = parseJson(response);
      if (readKey(answer, "ok") !== true) throw refusal();
      waiting?.resolve(answer);
    } catch {
      waiting?.reject(refusal());
    }
  });
  return {
    request(input) {
      if (stopped || pending !== undefined) return Promise.reject(refusal());
      return new Promise((resolve, reject) => {
        try {
          const body = JSON.stringify(input);
          if (body.length > 8 * 1024 * 1024) throw refusal();
          pending = { resolve, reject };
          child.stdin.write(`${body}\n`);
        } catch {
          pending = undefined;
          reject(refusal());
        }
      });
    },
    close() {
      if (stopped) return Promise.resolve();
      return new Promise((resolve) => {
        child.on("close", resolve);
        child.stdin.end();
      });
    },
  };
}

/** @param {unknown} input @returns {Promise<unknown>} */
export async function storageValidator(input) {
  const validator = createStorageValidator();
  try {
    return await validator.request(input);
  } finally {
    await validator.close();
  }
}
