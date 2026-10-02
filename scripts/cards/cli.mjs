#!/usr/bin/env node
// Entry point for every `pnpm cards:*` command: `node scripts/cards/cli.mjs
// <command> [--kind vocab] [args…]`. The skills under .agents/skills/*-card*
// are its callers; card JSON under content/cards/ and content/vocab/ is
// written only through here.
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
import {
  runVocabDupes,
  runVocabGaps,
  runVocabLint,
  runVocabNewId,
  runVocabQueue,
  runVocabShow,
  runVocabStats,
  vocabDupesSpec,
  vocabGapsSpec,
  vocabLintSpec,
  vocabNewIdSpec,
  vocabQueueSpec,
  vocabShowSpec,
  vocabStatsSpec,
} from "./vocab-inspect.mjs";
import {
  runVocabAdd,
  runVocabStamp,
  runVocabTombstone,
  runVocabUpdate,
  vocabAddSpec,
  vocabStampSpec,
  vocabTombstoneSpec,
  vocabUpdateSpec,
} from "./vocab-mutate.mjs";

/**
 * @typedef {import("./common.mjs").Context} Context
 */

/**
 * @typedef {object} Command
 * @property {import("./args.mjs").CommandSpec} spec
 * @property {(parsed: import("./args.mjs").Parsed, context: Context) => number} run
 */

/** Every command, by the name after `cards:`, for the drill's cards. */
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

/** The same commands for vocabulary cards, under `--kind vocab`. */
export const VOCAB_COMMANDS = /** @type {const} */ ({
  lint: { spec: vocabLintSpec, run: runVocabLint },
  gaps: { spec: vocabGapsSpec, run: runVocabGaps },
  dupes: { spec: vocabDupesSpec, run: runVocabDupes },
  "new-id": { spec: vocabNewIdSpec, run: runVocabNewId },
  add: { spec: vocabAddSpec, run: runVocabAdd },
  update: { spec: vocabUpdateSpec, run: runVocabUpdate },
  tombstone: { spec: vocabTombstoneSpec, run: runVocabTombstone },
  show: { spec: vocabShowSpec, run: runVocabShow },
  queue: { spec: vocabQueueSpec, run: runVocabQueue },
  stamp: { spec: vocabStampSpec, run: runVocabStamp },
  stats: { spec: vocabStatsSpec, run: runVocabStats },
});

/** The values `--kind` takes; the first is the default. */
export const KINDS = /** @type {const} */ (["composition", "vocab"]);

/**
 * @param {string} name - Candidate command name.
 * @param {string} kind - A value of {@link KINDS}.
 * @returns {Command | undefined} The command, when there is one.
 */
function lookup(name, kind) {
  const table = kind === "vocab" ? VOCAB_COMMANDS : COMMANDS;
  return Object.hasOwn(table, name)
    ? /** @type {Record<string, Command>} */ (table)[name]
    : undefined;
}

/**
 * Pull `--<flag> <value>` (or `--<flag>=<value>`) out of the arguments; every
 * command accepts `--root` and `--kind`.
 *
 * @param {readonly string[]} argv - Arguments after the command name.
 * @param {string} flag - The flag's name, without `--`.
 * @returns {{ value: string | undefined, rest: string[] }} Its value and the rest.
 */
function take(argv, flag) {
  /** @type {string[]} */
  const rest = [];
  /** @type {string | undefined} */
  let value;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === `--${flag}`) {
      index += 1;
      value = argv[index] ?? "";
    } else if (token.startsWith(`--${flag}=`)) {
      value = token.slice(`--${flag}=`.length);
    } else {
      rest.push(token);
    }
  }
  return { value, rest };
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
    formatter: prettierFormatter,
    random: (max) => randomInt(max),
    optionalFields: OPTIONAL_FIELDS,
    ...overrides,
  };
  const [name = "", ...args] = argv;
  try {
    const { value: kind = KINDS[0], rest: withoutKind } = take(args, "kind");
    /** @type {readonly string[]} */
    const kinds = KINDS;
    if (!kinds.includes(kind)) {
      throw new CardsError("ERR_CARDS_USAGE", `Unknown card kind "${kind}".`, {
        expected: `--kind ${KINDS.join(" | ")}`,
        actual: kind === "" ? "--kind without a value" : kind,
        next: `rerun as \`pnpm cards:${name === "" ? "<command>" : name} --kind vocab\`, or without --kind for the drill's cards.`,
      });
    }
    const command = lookup(name, kind);
    if (command === undefined) {
      throw new CardsError("ERR_CARDS_USAGE", `Unknown command "${name}".`, {
        expected: `one of: ${Object.keys(COMMANDS).join(", ")}`,
        actual: name === "" ? "no command" : name,
        next: "run `pnpm cards:<command>`, e.g. `pnpm cards:lint`.",
      });
    }
    const { value: root, rest } = take(withoutKind, "root");
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
