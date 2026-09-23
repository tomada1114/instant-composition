#!/usr/bin/env node
// `pnpm catalog:build`: turns content/ into one catalog snapshot per language
// pair, in the shape ADR-0004 decides — items anchored on the target sentence,
// prompts and explanations as localizations keyed by first language, CEFR
// levels, and concept ids namespaced by the target. The snapshot is build
// output under dist/, never committed; `catalogSnapshotOf` in
// packages/application reads what this writes.
//
// Only reviewed cards become items: a card is an item exactly when the rule
// the review tooling stamps against (`isShown`) says it is shown. A card edited
// since its review is listed as withdrawn with none of its text, and a deleted
// one keeps the prompt its tombstone recorded, so an answer that names either
// can still be taken.
import console from "node:console";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { readKey } from "../lib/json.mjs";
import { repoRoot } from "../lib/node-tools.mjs";
import { CardsError } from "../cards/errors.mjs";
import { ID_PATTERN, isShown } from "../cards/schema.mjs";
import { compareIds, DEFAULT_ROOT, displayPath, loadStore } from "../cards/store.mjs";

/** Where `pnpm catalog:build` writes, one `<target>/<l1>.json` per pair. */
export const DEFAULT_OUT = path.join(repoRoot, "dist", "catalog");

/** Bumped when a reader of an older snapshot could no longer read a newer one. */
export const FORMAT = 1;

/**
 * The language pairs content/ holds. Its cards are written with the prompt
 * and the explanation in Japanese (`ja`, `point`) and the model answer in
 * English (`en`); a second pair arrives with the card-schema rewrite ADR-0004
 * lists as a follow-up.
 */
const PAIRS = /** @type {const} */ ([{ target: "en", l1: "ja" }]);

/** The exam references `content/levels.json` records for an English target. */
const EXAMS = /** @type {const} */ (["toeic", "ielts", "toeflIbt"]);

/**
 * Every code `pnpm catalog:build` can exit with. A content root that cannot
 * be read at all fails with the `ERR_CARDS_*` code the card tooling reports.
 *
 * - Fix the invocation: `ERR_CATALOG_USAGE`.
 * - Fix the content (`pnpm cards:lint` names the same problems):
 *   `ERR_CATALOG_CONTENT`.
 * - Fix the output directory: `ERR_CATALOG_WRITE`.
 *
 * @typedef {"ERR_CATALOG_USAGE" | "ERR_CATALOG_CONTENT" | "ERR_CATALOG_WRITE"} CatalogErrorCode
 */

/** A failure that stops `pnpm catalog:build`, reported on stderr. */
export class CatalogError extends Error {
  /**
   * @param {CatalogErrorCode} code - Stable identifier a caller branches on.
   * @param {string} message - One sentence saying what failed.
   * @param {{ expected: string, actual: string, next: string, cause?: unknown }} details
   *   - Expected, actual and the next step.
   */
  constructor(code, message, details) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "CatalogError";
    /** @type {CatalogErrorCode} */
    this.code = code;
    this.expected = details.expected;
    this.actual = details.actual;
    this.next = details.next;
  }

  /** @returns {string} The multi-line stderr report. */
  report() {
    return (
      `${this.code}: ${this.message}\n` +
      `Expected: ${this.expected}\n` +
      `Actual: ${this.actual}\n` +
      `Next: ${this.next}`
    );
  }
}

/**
 * @typedef {object} Card
 * @property {string} id
 * @property {string} ja
 * @property {string} en
 * @property {string[]} alternatives
 * @property {string} point
 * @property {string} topic
 * @property {string} subtopic
 * @property {number} level
 * @property {string[]} grammar
 * @property {unknown} stamps
 */

/**
 * @typedef {object} CatalogDocument
 * @property {number} format
 * @property {string} version - `sha256:<hex>` over the rest of the document.
 * @property {string} target
 * @property {string} l1
 * @property {unknown[]} levels
 * @property {unknown[]} concepts
 * @property {unknown[]} topics
 * @property {unknown[]} items
 * @property {unknown[]} withdrawn
 * @property {unknown[]} tombstones
 */

/**
 * @param {unknown} value - Candidate.
 * @returns {value is string[]} True for an array of strings.
 */
function isStrings(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * @param {unknown} value - Candidate.
 * @returns {value is string} True for a non-empty string.
 */
function isText(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Narrow a stored card to the fields a snapshot is built from.
 *
 * @param {Record<string, unknown>} raw - The card as stored.
 * @returns {Card | undefined} The card, when every core field has its type.
 */
function asCard(raw) {
  const { id, ja, en, alternatives, point, topic, subtopic, level, grammar, stamps } =
    raw;
  if (
    typeof id !== "string" ||
    !ID_PATTERN.test(id) ||
    !isText(ja) ||
    !isText(en) ||
    !isStrings(alternatives) ||
    typeof point !== "string" ||
    !isText(topic) ||
    !isText(subtopic) ||
    typeof level !== "number" ||
    !Number.isInteger(level) ||
    level < 1 ||
    level > 10 ||
    !isStrings(grammar)
  ) {
    return undefined;
  }
  return { id, ja, en, alternatives, point, topic, subtopic, level, grammar, stamps };
}

/**
 * Words the way packages/domain's `countWords` counts a model answer, so a
 * withdrawn card keeps the time limit it had while it was shown.
 *
 * @param {string} text - A model answer.
 * @returns {number} Its whitespace-separated words.
 */
function answerWords(text) {
  return text.split(/\s+/u).filter((word) => word !== "").length;
}

/**
 * @param {string} target - The target language.
 * @param {string} grammar - A grammar id from `content/grammar.json`.
 * @returns {string} The concept id, namespaced by the target.
 */
function grammarConcept(target, grammar) {
  return `${target}:grammar/${grammar}`;
}

/**
 * @param {import("../cards/store.mjs").Store} store - The loaded content root.
 * @param {string} target - The target language.
 * @returns {unknown[]} Each level with its CEFR band and exam references.
 * @throws {CatalogError} `ERR_CATALOG_CONTENT` when a level lacks either.
 */
function levelsOf(store, target) {
  /** @type {string[]} */
  const problems = [];
  const levels = [...store.lists.levels.values()].map(({ level, raw }) => {
    const cefr = readKey(raw, "cefr");
    /** @type {Record<string, string | null>} */
    const exams = {};
    for (const exam of EXAMS) {
      const score = readKey(raw, exam);
      if (typeof score === "string" || score === null) {
        exams[exam] = score;
      } else {
        problems.push(`levels.json: level ${String(level)} has no \`${exam}\``);
      }
    }
    if (!isText(cefr)) {
      problems.push(`levels.json: level ${String(level)} has no \`cefr\``);
    }
    return { level, cefr, exams };
  });
  if (problems.length > 0) {
    throw new CatalogError(
      "ERR_CATALOG_CONTENT",
      `The ${target} levels do not declare their CEFR band and exam references.`,
      {
        expected: `every level in levels.json with a \`cefr\` string and ${EXAMS.map((exam) => `\`${exam}\``).join(", ")} as a string or null`,
        actual: problems.join("; "),
        next: "fix levels.json (`git diff content/levels.json` shows recent edits), then rerun `pnpm catalog:build`.",
      },
    );
  }
  return levels;
}

/**
 * @param {import("../cards/store.mjs").Store} store - The loaded content root.
 * @returns {Card[]} Every card, sorted by id.
 * @throws {CatalogError} `ERR_CATALOG_CONTENT` naming each card that lacks a
 *   core field or repeats an id.
 */
function cardsOf(store) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, Card>} */
  const cards = new Map();
  for (const entry of store.cards) {
    const where = displayPath(store.root, `cards/${entry.file}`);
    const card = asCard(entry.raw);
    if (card === undefined) {
      problems.push(`${where} card #${String(entry.index)} lacks a core field`);
    } else if (cards.has(card.id)) {
      problems.push(`${where}: id ${card.id} is used twice`);
    } else {
      cards.set(card.id, card);
    }
  }
  if (problems.length > 0) {
    throw new CatalogError("ERR_CATALOG_CONTENT", "Some cards cannot be built.", {
      expected: "every card with a unique id and all of its core fields",
      actual: problems.join("; "),
      next: "run `pnpm cards:lint` and fix what it reports, then rerun `pnpm catalog:build`.",
    });
  }
  return [...cards.values()].sort((left, right) => compareIds(left.id, right.id));
}

/**
 * @param {Omit<CatalogDocument, "version" | "format">} body - The document
 *   without its version.
 * @returns {string} `sha256:<hex>` of the body's JSON.
 */
function versionOf(body) {
  const digest = createHash("sha256")
    .update(JSON.stringify(body), "utf8")
    .digest("hex");
  return `sha256:${digest}`;
}

/**
 * Build the snapshot of one language pair from a loaded content root.
 *
 * @param {import("../cards/store.mjs").Store} store - The loaded content root.
 * @param {{ target: string, l1: string }} pair - The pair to build.
 * @returns {CatalogDocument} The snapshot.
 * @throws {CatalogError} `ERR_CATALOG_CONTENT` on a card or level that
 *   cannot be built.
 */
export function catalogDocument(store, pair) {
  const { target, l1 } = pair;
  const levels = levelsOf(store, target);
  const cards = cardsOf(store);
  const shown = cards.filter((card) => isShown(card));
  const withdrawn = cards.filter((card) => !isShown(card));
  const body = {
    target,
    l1,
    levels,
    concepts: store.lists.grammar.map((item) => ({
      id: grammarConcept(target, item.id),
      names: { [l1]: item.ja },
    })),
    topics: store.lists.topics.map((topic) => ({
      id: topic.id,
      names: { [l1]: topic.ja },
      subtopics: topic.subtopics.map((subtopic) => ({
        id: subtopic.id,
        names: { [l1]: subtopic.ja },
      })),
    })),
    items: shown.map((card) => ({
      id: card.id,
      target,
      text: card.en,
      alternatives: card.alternatives,
      concepts: card.grammar.map((grammar) => grammarConcept(target, grammar)),
      level: card.level,
      topic: card.topic,
      subtopic: card.subtopic,
      localizations: { [l1]: { prompt: card.ja, explanation: card.point } },
    })),
    withdrawn: withdrawn.map((card) => ({
      id: card.id,
      topic: card.topic,
      subtopic: card.subtopic,
      level: card.level,
      words: answerWords(card.en),
    })),
    tombstones: [...store.tombstones]
      .sort((left, right) => compareIds(left.id, right.id))
      .map((tombstone) => ({
        id: tombstone.id,
        topic: tombstone.topic,
        subtopic: tombstone.subtopic,
        level: tombstone.level,
        localizations: { [l1]: { prompt: tombstone.ja } },
      })),
  };
  return { format: FORMAT, version: versionOf(body), ...body };
}

/**
 * @param {unknown} error - What a filesystem call threw.
 * @returns {string} Its system code, such as `ENOTDIR`, never its message,
 *   which quotes the absolute path.
 */
function systemCode(error) {
  const code = readKey(error, "code");
  return typeof code === "string" ? code : "an unknown error";
}

/**
 * @typedef {object} Built
 * @property {string} file - Where the snapshot was written.
 * @property {CatalogDocument} document - What was written there.
 */

/**
 * Build every pair's snapshot from a content root and write each to
 * `<out>/<target>/<l1>.json`.
 *
 * @param {{ root: string, out: string }} options - The content root and the
 *   output directory.
 * @returns {Built[]} One entry per pair.
 * @throws {CatalogError | CardsError} When the content cannot be read or
 *   built, or the output cannot be written.
 */
export function buildCatalog(options) {
  const store = loadStore(options.root);
  return PAIRS.map((pair) => {
    const document = catalogDocument(store, pair);
    const file = path.join(options.out, pair.target, `${pair.l1}.json`);
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
    } catch (error) {
      throw new CatalogError(
        "ERR_CATALOG_WRITE",
        "The catalog snapshot could not be written.",
        {
          expected: "a writable output directory",
          actual: `${pair.target}/${pair.l1}.json under the output directory failed with ${systemCode(error)}`,
          next: "pass a writable directory with `--out <dir>`, or rerun `pnpm catalog:build` for dist/catalog.",
          cause: error,
        },
      );
    }
    return { file, document };
  });
}

const USAGE = "pnpm catalog:build [--root <content dir>] [--out <output dir>]";

/**
 * @param {readonly string[]} argv - Arguments after the script.
 * @returns {{ root: string, out: string }} The content root and output directory.
 * @throws {CatalogError} `ERR_CATALOG_USAGE` on anything else.
 */
export function parseOptions(argv) {
  const options = { root: DEFAULT_ROOT, out: DEFAULT_OUT };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index] ?? "";
    const value = argv[index + 1] ?? "";
    if ((flag !== "--root" && flag !== "--out") || value === "") {
      throw new CatalogError(
        "ERR_CATALOG_USAGE",
        "Invalid arguments for catalog:build.",
        {
          expected: USAGE,
          actual: argv.join(" "),
          next: `rerun as \`${USAGE}\`.`,
        },
      );
    }
    options[flag === "--root" ? "root" : "out"] = path.resolve(value);
  }
  return options;
}

/**
 * @param {string} file - An absolute path.
 * @returns {string} The path from the repository root, when it is inside it.
 */
function shownPath(file) {
  const relative = path.relative(repoRoot, file);
  return relative.startsWith("..") || path.isAbsolute(relative)
    ? path.basename(path.dirname(file)) + "/" + path.basename(file)
    : relative.split(path.sep).join("/");
}

/**
 * Run `pnpm catalog:build`.
 *
 * @param {readonly string[]} argv - Arguments after the script.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} [io] -
 *   Where the report and failures go.
 * @returns {number} Process exit code: 0 on success, 1 on failure.
 */
export function main(
  argv,
  io = {
    out: (text) => {
      console.log(text);
    },
    err: (text) => {
      console.error(text);
    },
  },
) {
  try {
    for (const { file, document } of buildCatalog(parseOptions(argv))) {
      io.out(
        `Wrote ${shownPath(file)}: ${String(document.items.length)} items, ` +
          `${String(document.withdrawn.length)} withdrawn, ` +
          `${String(document.tombstones.length)} tombstones (${document.version}).`,
      );
    }
    return 0;
  } catch (error) {
    if (!(error instanceof CatalogError) && !(error instanceof CardsError)) throw error;
    io.err(error.report());
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
