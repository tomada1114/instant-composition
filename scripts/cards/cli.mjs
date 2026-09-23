#!/usr/bin/env node
// Entry point for every `pnpm cards:*` command: `node scripts/cards/cli.mjs
// <command> [args…]`. The skills under .agents/skills/*-card* are its
// callers; card JSON under content/cards/ is written only through here.
import console from "node:console";
import { randomInt } from "node:crypto";
import path from "node:path";
import process from "node:process";

import { parseArgs, usageError } from "./args.mjs";
import { localDate } from "./common.mjs";
import { CardsError } from "./errors.mjs";
import {
  dupesSpec,
  gapsSpec,
  lintSpec,
  newIdSpec,
  queueSpec,
  runDupes,
  runGaps,
  runLint,
  runNewId,
  runQueue,
  runShow,
  runStats,
  showSpec,
  statsSpec,
} from "./inspect.mjs";
import {
  addSpec,
  runAdd,
  runStamp,
  runTombstone,
  runUpdate,
  stampSpec,
  tombstoneSpec,
  updateSpec,
} from "./mutate.mjs";
import { OPTIONAL_FIELDS } from "./schema.mjs";
import { DEFAULT_ROOT, prettierFormatter } from "./store.mjs";

/**
 * @typedef {import("./common.mjs").Context} Context
 */

/**
 * @typedef {object} Command
 * @property {import("./args.mjs").CommandSpec} spec
 * @property {(parsed: import("./args.mjs").Parsed, context: Context) => number} run
 */

/** Every command, by the name after `cards:`. */
export const COMMANDS = /** @type {const} */ ({
  lint: { spec: lintSpec, run: runLint },
  gaps: { spec: gapsSpec, run: runGaps },
  dupes: { spec: dupesSpec, run: runDupes },
  "new-id": { spec: newIdSpec, run: runNewId },
  add: { spec: addSpec, run: runAdd },
  update: { spec: updateSpec, run: runUpdate },
  tombstone: { spec: tombstoneSpec, run: runTombstone },
  show: { spec: showSpec, run: runShow },
  queue: { spec: queueSpec, run: runQueue },
  stamp: { spec: stampSpec, run: runStamp },
  stats: { spec: statsSpec, run: runStats },
});

/**
 * @param {string} name - Candidate command name.
 * @returns {Command | undefined} The command, when there is one.
 */
function lookup(name) {
  return Object.hasOwn(COMMANDS, name)
    ? /** @type {Record<string, Command>} */ (COMMANDS)[name]
    : undefined;
}

/**
 * Pull `--root <dir>` out of the arguments; every command accepts it.
 *
 * @param {readonly string[]} argv - Arguments after the command name.
 * @returns {{ root: string | undefined, rest: string[] }} The root and the rest.
 */
function takeRoot(argv) {
  /** @type {string[]} */
  const rest = [];
  /** @type {string | undefined} */
  let root;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--root") {
      index += 1;
      root = argv[index] ?? "";
    } else if (token.startsWith("--root=")) {
      root = token.slice("--root=".length);
    } else {
      rest.push(token);
    }
  }
  return { root, rest };
}

/**
 * Run one `cards:*` command.
 *
 * @param {readonly string[]} argv - `<command> [args…]`.
 * @param {Partial<Context>} [overrides] - Replaces parts of the default
 *   context; tests pass a temporary root, a fixed date and a capture sink.
 * @returns {number} Process exit code: 0 on success, 1 on failure.
 */
export function main(argv, overrides = {}) {
  /** @type {Context} */
  const context = {
    root: DEFAULT_ROOT,
    out: (text) => {
      console.log(text);
    },
    err: (text) => {
      console.error(text);
    },
    today: () => localDate(new Date()),
    format: prettierFormatter,
    random: (max) => randomInt(max),
    optionalFields: OPTIONAL_FIELDS,
    ...overrides,
  };
  const [name = "", ...args] = argv;
  try {
    const command = lookup(name);
    if (command === undefined) {
      throw new CardsError("ERR_CARDS_USAGE", `Unknown command "${name}".`, {
        expected: `one of: ${Object.keys(COMMANDS).join(", ")}`,
        actual: name === "" ? "no command" : name,
        next: "run `pnpm cards:<command>`, e.g. `pnpm cards:lint`.",
      });
    }
    const { root, rest } = takeRoot(args);
    if (root === "") throw usageError(name, command.spec, "--root needs a directory");
    if (root !== undefined) context.root = path.resolve(root);
    return command.run(parseArgs(name, command.spec, rest), context);
  } catch (error) {
    if (!(error instanceof CardsError)) throw error;
    context.err(error.report());
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
