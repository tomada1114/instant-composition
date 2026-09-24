#!/usr/bin/env node
// `pnpm dev`: the whole local stack in one terminal. The package script runs
// `pnpm db:up` first, which returns once DynamoDB local passes its health
// check; this then builds the catalog snapshot when there is none and runs the
// API (`pnpm api`) and the web client's Vite dev server (`pnpm web`) side by
// side. Ctrl-C stops both. DynamoDB local keeps running, and its tables with
// it, until `pnpm db:down`.
//
// Both children are run on this process's own Node, as `pnpm api` and
// `pnpm web` run them, rather than through pnpm: a second package manager
// process per child would be one more layer between Ctrl-C and the server.
import { spawn } from "node:child_process";
import console from "node:console";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";

import { repoRoot, runNode } from "./lib/node-tools.mjs";

/**
 * The catalog snapshot the API reads when `API_CATALOG_PATH` is unset, relative
 * to the repository root. `apps/api/src/env.ts` holds the same default, and
 * `tests/dev.test.ts` holds the two together.
 */
export const DEFAULT_CATALOG = "dist/catalog/en/ja.json";

/** How long a child that was asked to stop gets before it is killed outright. */
const STOP_GRACE_MS = 5_000;

/**
 * One long-running process of the stack.
 *
 * @typedef {object} StackProcess
 * @property {string} name - What the stderr report calls it.
 * @property {string} entry - The script Node runs, which has to exist.
 * @property {string[]} args - Every argument after the Node executable.
 * @property {string} cwd - Its working directory.
 */

/**
 * The processes `pnpm dev` runs: the API as `pnpm api` starts it, and the web
 * client's Vite dev server as `pnpm web` starts it.
 *
 * @param {string} [root] - The repository root.
 * @returns {StackProcess[]} The API first, then the web client.
 */
export function stackProcesses(root = repoRoot) {
  const api = path.join(root, "apps", "api", "src", "main.ts");
  const web = path.join(root, "apps", "web");
  const vite = path.join(web, "node_modules", "vite", "bin", "vite.js");
  return [
    {
      name: "api",
      entry: api,
      args: ["--import", "./scripts/ts-hooks.mjs", "apps/api/src/main.ts"],
      cwd: root,
    },
    { name: "web", entry: vite, args: [vite], cwd: web },
  ];
}

/**
 * Every code `pnpm dev` can stop with.
 *
 * - Install the dependencies: `ERR_DEV_NOT_INSTALLED`.
 * - Fix the content (`pnpm cards:lint` names the problem): `ERR_DEV_CATALOG`.
 * - Read the process's own output above the report: `ERR_DEV_EXITED`.
 *
 * @typedef {"ERR_DEV_NOT_INSTALLED" | "ERR_DEV_CATALOG" | "ERR_DEV_EXITED"} DevErrorCode
 */

/** A failure that stops `pnpm dev`, reported on stderr. */
export class DevError extends Error {
  /**
   * @param {DevErrorCode} code - Stable identifier a caller branches on.
   * @param {string} message - One sentence saying what failed.
   * @param {{ expected: string, actual: string, next: string }} details
   */
  constructor(code, message, details) {
    super(message);
    this.name = "DevError";
    this.code = code;
    this.expected = details.expected;
    this.actual = details.actual;
    this.next = details.next;
  }

  /** @returns {string} The report printed on stderr. */
  report() {
    return [
      `${this.code}: ${this.message}`,
      `Expected: ${this.expected}`,
      `Actual: ${this.actual}`,
      `Next: ${this.next}`,
    ].join("\n");
  }
}

/**
 * Fail unless every process's entry script is on disk.
 *
 * @param {readonly StackProcess[]} processes
 * @returns {void}
 * @throws {DevError} `ERR_DEV_NOT_INSTALLED`, naming each missing entry.
 */
export function assertInstalled(processes) {
  const missing = processes.filter((spec) => !existsSync(spec.entry));
  if (missing.length > 0) {
    throw new DevError("ERR_DEV_NOT_INSTALLED", "the stack cannot start.", {
      expected: "every process's entry script on disk.",
      actual: `missing: ${missing
        .map((spec) => `${spec.name} (${path.relative(repoRoot, spec.entry)})`)
        .join(", ")}.`,
      next: "run `pnpm install`, then `pnpm dev` again.",
    });
  }
}

/**
 * Build the catalog snapshot the API reads, when it reads the default one and
 * that is missing.
 *
 * @remarks
 * A snapshot named by `API_CATALOG_PATH` is the caller's, and is never built
 * here. One already on disk is used as it is, however old: rebuilding it is
 * `pnpm catalog:build`'s job, and the API reads it again on the next request
 * that needs it.
 *
 * @param {Readonly<Record<string, string | undefined>>} env - The environment the API will read.
 * @param {object} [options]
 * @param {string} [options.root] - The repository root.
 * @param {() => { status: number, stderr: string }} [options.build] - Runs `pnpm catalog:build`.
 * @returns {"configured" | "present" | "built"} What was done.
 * @throws {DevError} `ERR_DEV_CATALOG` when the build fails.
 */
export function ensureCatalog(env, options = {}) {
  const root = options.root ?? repoRoot;
  if ((env["API_CATALOG_PATH"] ?? "").trim() !== "") return "configured";
  if (existsSync(path.join(root, DEFAULT_CATALOG))) return "present";
  const build =
    options.build ??
    (() =>
      runNode(path.join(root, "scripts", "catalog", "build.mjs"), [], { cwd: root }));
  const result = build();
  if (result.status !== 0) {
    throw new DevError("ERR_DEV_CATALOG", "the catalog snapshot could not be built.", {
      expected: `${DEFAULT_CATALOG}, written by \`pnpm catalog:build\`.`,
      actual:
        result.stderr.trim() === ""
          ? "it failed without a report."
          : result.stderr.trim(),
      next: "run `pnpm cards:lint`, fix what it reports, then `pnpm dev` again.",
    });
  }
  return "built";
}

/**
 * Where a stop request comes from: the process itself, or a stand-in a test
 * emits on.
 *
 * @typedef {object} SignalSource
 * @property {(signal: "SIGINT" | "SIGTERM", handler: () => void) => unknown} on
 * @property {(signal: "SIGINT" | "SIGTERM", handler: () => void) => unknown} off
 */

/**
 * Run every process until one exits or a stop signal arrives, then stop the
 * rest and resolve once all of them are gone.
 *
 * @remarks
 * A process that exits on its own takes the others down with it, because a
 * stack missing its API or its client is not one worth leaving half up; the
 * run then resolves 1 after `ERR_DEV_EXITED` names it. A stop signal resolves
 * 0. A child that ignores `SIGTERM` is killed after {@link STOP_GRACE_MS}.
 *
 * @param {readonly StackProcess[]} processes
 * @param {object} [options]
 * @param {SignalSource} [options.signals] - Defaults to this process.
 * @param {string} [options.execPath] - The Node each process runs on.
 * @param {number} [options.graceMs] - How long a stopped child gets before `SIGKILL`.
 * @returns {Promise<number>} The exit code.
 */
export function superviseStack(processes, options = {}) {
  const signals = options.signals ?? process;
  const execPath = options.execPath ?? process.execPath;
  const graceMs = options.graceMs ?? STOP_GRACE_MS;
  return new Promise((resolve) => {
    let stopping = false;
    let exitCode = 0;
    let running = processes.length;
    /** @type {NodeJS.Timeout | undefined} */
    let escalation;

    const children = processes.map((spec) => {
      const child = spawn(execPath, spec.args, {
        cwd: spec.cwd,
        env: process.env,
        stdio: ["ignore", "inherit", "inherit"],
      });
      let settled = false;
      /** @param {string} how */
      const settle = (how) => {
        if (settled) return;
        settled = true;
        running -= 1;
        if (!stopping) {
          exitCode = 1;
          console.error(
            new DevError(
              "ERR_DEV_EXITED",
              `the ${spec.name} process stopped on its own.`,
              {
                expected: "every process running until Ctrl-C.",
                actual: `${spec.name} ${how}.`,
                next: `read ${spec.name}'s output above, fix what it reports, then \`pnpm dev\` again.`,
              },
            ).report(),
          );
          stop();
        }
        if (running === 0) {
          clearTimeout(escalation);
          signals.off("SIGINT", stop);
          signals.off("SIGTERM", stop);
          resolve(exitCode);
        }
      };
      child.on("error", (error) => {
        settle(`could not run (${error.message})`);
      });
      child.on("exit", (code, signal) => {
        // Ctrl-C reaches every process in the terminal's foreground group at
        // once, so a child can be gone before this process's own handler has
        // run: an interrupt it received is a stop, not a failure.
        if (signal === "SIGINT" || signal === "SIGTERM") stop();
        settle(
          signal === null ? `exited with ${String(code)}` : `was ended by ${signal}`,
        );
      });
      return child;
    });

    function stop() {
      if (stopping) return;
      stopping = true;
      const live = children.filter(
        (child) => child.exitCode === null && child.signalCode === null,
      );
      for (const child of live) child.kill("SIGTERM");
      escalation = setTimeout(() => {
        for (const child of live) {
          if (child.exitCode === null && child.signalCode === null)
            child.kill("SIGKILL");
        }
      }, graceMs);
      escalation.unref();
    }

    signals.on("SIGINT", stop);
    signals.on("SIGTERM", stop);
  });
}

/**
 * Start the stack and resolve with the exit code.
 *
 * @param {Readonly<Record<string, string | undefined>>} [env]
 * @returns {Promise<number>}
 */
export async function main(env = process.env) {
  const processes = stackProcesses();
  try {
    assertInstalled(processes);
    if (ensureCatalog(env) === "built") {
      console.log(`dev: built ${DEFAULT_CATALOG} from content/.`);
    }
  } catch (error) {
    if (!(error instanceof DevError)) throw error;
    console.error(error.report());
    return 1;
  }
  console.log(
    "dev: starting the API and the web client. Ctrl-C stops both; `pnpm db:down` stops DynamoDB local.",
  );
  return superviseStack(processes);
}

if (import.meta.main) {
  process.exitCode = await main();
}
