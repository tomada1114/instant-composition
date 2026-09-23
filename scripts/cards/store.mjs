// Reading and writing everything under the content root: the tag lists, the
// card files, and the tombstone log. Every write goes through here so the
// files keep one canonical shape.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { parseJson, readKey } from "../lib/json.mjs";
import { repoRoot, runNode } from "../lib/node-tools.mjs";
import { CardsError } from "./errors.mjs";
import { CORE_FIELDS } from "./schema.mjs";

/** The content root this repository ships. */
export const DEFAULT_ROOT = path.join(repoRoot, "content");

// A taxonomy id becomes a directory or file name, so it is held to a shape
// that cannot climb out of `cards/` or collide on a case-insensitive disk.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * @typedef {object} Subtopic
 * @property {string} id
 * @property {string} ja
 * @property {string} scene
 */

/**
 * @typedef {object} Topic
 * @property {string} id
 * @property {string} ja
 * @property {Subtopic[]} subtopics
 */

/**
 * @typedef {object} Level
 * @property {number} level
 * @property {{ min: number, max: number }} words
 * @property {string} summary
 * @property {unknown} raw - The entry as written, for briefs that quote it.
 */

/**
 * @typedef {object} GrammarItem
 * @property {string} id
 * @property {string} ja
 * @property {number} minLevel
 * @property {number} maxLevel
 * @property {string} example
 */

/**
 * @typedef {object} Lists
 * @property {Topic[]} topics
 * @property {Map<number, Level>} levels
 * @property {GrammarItem[]} grammar
 * @property {Map<string, GrammarItem>} grammarById
 * @property {number} perspectivesVersion
 */

/**
 * @typedef {object} CardEntry
 * @property {Record<string, unknown>} raw - The card as stored.
 * @property {string} file - Its file, relative to `cards/`.
 * @property {number} index - Its position in that file.
 */

/**
 * @typedef {object} Tombstone
 * @property {string} id
 * @property {string} ja
 * @property {string} en
 * @property {string} topic
 * @property {string} subtopic
 * @property {number} level
 * @property {string} reason
 * @property {string} deletedAt
 * @property {string} [replacedBy]
 */

/**
 * @typedef {object} Store
 * @property {string} root - The content root.
 * @property {Lists} lists
 * @property {CardEntry[]} cards - Every card, file by file.
 * @property {Map<string, Record<string, unknown>[]>} files - Card files by
 *   path relative to `cards/`, each as stored.
 * @property {string[]} strayFiles - Files under `cards/` at no
 *   `<topic>/<subtopic>.json` path.
 * @property {Tombstone[]} tombstones
 */

/**
 * @param {string} root - Content root.
 * @param {string} relative - Path under it.
 * @returns {string} The path as a reader should see it.
 */
export function displayPath(root, relative) {
  const absolute = path.join(root, relative);
  const fromRepo = path.relative(repoRoot, absolute);
  return fromRepo.startsWith("..") || path.isAbsolute(fromRepo)
    ? relative
    : fromRepo.split(path.sep).join("/");
}

/**
 * @param {string} root - Content root.
 * @param {string} relative - Path under it.
 * @returns {unknown} The parsed JSON.
 * @throws {CardsError} `ERR_CARDS_CONTENT` when it is missing or not JSON.
 */
function readListFile(root, relative) {
  try {
    return parseJson(readFileSync(path.join(root, relative), "utf8"));
  } catch (error) {
    throw new CardsError(
      "ERR_CARDS_CONTENT",
      `${displayPath(root, relative)} could not be read.`,
      {
        expected: "a readable JSON file",
        actual: error instanceof Error ? error.message : String(error),
        next: `restore ${displayPath(root, relative)} from git (\`git diff\` shows what changed).`,
        cause: error,
      },
    );
  }
}

/**
 * @param {unknown} value - Candidate.
 * @returns {value is number} True for an integer.
 */
function isInt(value) {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * @param {unknown} value - Candidate.
 * @returns {value is string} True for a non-empty string.
 */
function isText(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * @param {unknown} value - Candidate.
 * @returns {unknown[]} The value when it is an array, else an empty one.
 */
function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Parse and cross-check taxonomy, levels and grammar, and read the current
 * `perspectivesVersion`.
 *
 * @param {string} root - Content root.
 * @returns {Lists} The validated lists.
 * @throws {CardsError} `ERR_CARDS_CONTENT` listing every problem found.
 */
export function loadLists(root) {
  /** @type {string[]} */
  const problems = [];

  /** @type {Topic[]} */
  const topics = [];
  const taxonomy = readListFile(root, "taxonomy.json");
  if (!Array.isArray(readKey(taxonomy, "topics"))) {
    problems.push("taxonomy.json: `topics` is not an array");
  }
  for (const [index, rawTopic] of arrayOf(readKey(taxonomy, "topics")).entries()) {
    const id = readKey(rawTopic, "id");
    const ja = readKey(rawTopic, "ja");
    if (typeof id !== "string" || !SLUG.test(id) || !isText(ja)) {
      problems.push(
        `taxonomy.json: topic #${String(index)} needs a slug \`id\` and a \`ja\``,
      );
      continue;
    }
    if (topics.some((topic) => topic.id === id)) {
      problems.push(`taxonomy.json: topic id "${id}" is declared twice`);
    }
    /** @type {Subtopic[]} */
    const subtopics = [];
    for (const [subIndex, rawSub] of arrayOf(
      readKey(rawTopic, "subtopics"),
    ).entries()) {
      const subId = readKey(rawSub, "id");
      const subJa = readKey(rawSub, "ja");
      const scene = readKey(rawSub, "scene");
      if (
        typeof subId !== "string" ||
        !SLUG.test(subId) ||
        !isText(subJa) ||
        !isText(scene)
      ) {
        problems.push(
          `taxonomy.json: ${id} subtopic #${String(subIndex)} needs a slug \`id\`, a \`ja\` and a \`scene\``,
        );
        continue;
      }
      if (subtopics.some((sub) => sub.id === subId)) {
        problems.push(`taxonomy.json: subtopic id "${id}/${subId}" is declared twice`);
      }
      subtopics.push({ id: subId, ja: subJa, scene });
    }
    if (subtopics.length === 0) {
      problems.push(`taxonomy.json: topic "${id}" has no subtopics`);
    }
    topics.push({ id, ja, subtopics });
  }

  /** @type {Map<number, Level>} */
  const levels = new Map();
  const levelsFile = readListFile(root, "levels.json");
  for (const [index, rawLevel] of arrayOf(readKey(levelsFile, "levels")).entries()) {
    const level = readKey(rawLevel, "level");
    const words = readKey(rawLevel, "words");
    const min = readKey(words, "min");
    const max = readKey(words, "max");
    const summary = readKey(rawLevel, "summary");
    if (!isInt(level) || !isInt(min) || !isInt(max) || !isText(summary)) {
      problems.push(
        `levels.json: entry #${String(index)} needs an integer \`level\`, \`words.min\`, \`words.max\` and a \`summary\``,
      );
      continue;
    }
    if (level !== index + 1) {
      problems.push(
        `levels.json: entry #${String(index)} is level ${String(level)}, expected ${String(index + 1)}`,
      );
    }
    if (min < 1 || min > max) {
      problems.push(
        `levels.json: level ${String(level)} has words ${String(min)}–${String(max)}`,
      );
    }
    levels.set(level, { level, words: { min, max }, summary, raw: rawLevel });
  }
  if (levels.size !== 10) {
    problems.push(
      `levels.json: expected levels 1–10, found ${String(levels.size)} valid entries`,
    );
  }

  /** @type {GrammarItem[]} */
  const grammar = [];
  /** @type {Map<string, GrammarItem>} */
  const grammarById = new Map();
  const grammarFile = readListFile(root, "grammar.json");
  for (const [index, rawItem] of arrayOf(readKey(grammarFile, "items")).entries()) {
    const id = readKey(rawItem, "id");
    const ja = readKey(rawItem, "ja");
    const minLevel = readKey(rawItem, "minLevel");
    const maxLevel = readKey(rawItem, "maxLevel");
    const example = readKey(rawItem, "example");
    if (
      typeof id !== "string" ||
      !SLUG.test(id) ||
      !isText(ja) ||
      !isInt(minLevel) ||
      !isInt(maxLevel) ||
      !isText(example)
    ) {
      problems.push(
        `grammar.json: item #${String(index)} needs a slug \`id\`, \`ja\`, integer \`minLevel\`/\`maxLevel\` and an \`example\``,
      );
      continue;
    }
    if (grammarById.has(id)) {
      problems.push(`grammar.json: id "${id}" is declared twice`);
    }
    if (minLevel < 1 || maxLevel > 10 || minLevel > maxLevel) {
      problems.push(
        `grammar.json: "${id}" has levels ${String(minLevel)}–${String(maxLevel)}, expected 1 ≤ min ≤ max ≤ 10`,
      );
    }
    const item = { id, ja, minLevel, maxLevel, example };
    grammar.push(item);
    grammarById.set(id, item);
  }
  if (grammar.length === 0) problems.push("grammar.json: `items` is empty or missing");

  let perspectivesVersion = 0;
  const perspectivesPath = path.join("guides", "review-perspectives.md");
  try {
    const match = /^perspectivesVersion:\s*(\d+)\s*$/mu.exec(
      readFileSync(path.join(root, perspectivesPath), "utf8"),
    );
    if (match?.[1] === undefined) {
      problems.push(`${perspectivesPath}: no \`perspectivesVersion: <int>\` line`);
    } else {
      perspectivesVersion = Number(match[1]);
    }
  } catch {
    problems.push(`${perspectivesPath}: could not be read`);
  }

  if (problems.length > 0) {
    throw new CardsError(
      "ERR_CARDS_CONTENT",
      "The tag lists under the content root are inconsistent.",
      {
        expected:
          "taxonomy.json, levels.json, grammar.json and guides/review-perspectives.md to parse and agree",
        actual: problems.join("; "),
        next: "fix the listed entries (`git diff content/` shows recent edits), then rerun `pnpm cards:lint`.",
      },
    );
  }
  return { topics, levels, grammar, grammarById, perspectivesVersion };
}

/**
 * @param {string} topic - Topic id.
 * @param {string} subtopic - Subtopic id.
 * @returns {string} The card file for that cell, relative to `cards/`.
 */
export function cardFile(topic, subtopic) {
  return `${topic}/${subtopic}.json`;
}

/**
 * @param {string} directory - Directory to walk.
 * @param {string} prefix - Path of `directory` relative to `cards/`.
 * @returns {string[]} Every file below it, relative to `cards/`, `/`-separated.
 */
function listFiles(directory, prefix) {
  if (!existsSync(directory)) return [];
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...listFiles(path.join(directory, entry.name), relative));
    } else {
      found.push(relative);
    }
  }
  return found.sort();
}

/**
 * @param {unknown} value - A parsed tombstone line.
 * @returns {Tombstone | undefined} The tombstone, when it has every field.
 */
function asTombstone(value) {
  const id = readKey(value, "id");
  const ja = readKey(value, "ja");
  const en = readKey(value, "en");
  const topic = readKey(value, "topic");
  const subtopic = readKey(value, "subtopic");
  const level = readKey(value, "level");
  const reason = readKey(value, "reason");
  const deletedAt = readKey(value, "deletedAt");
  const replacedBy = readKey(value, "replacedBy");
  if (
    typeof id !== "string" ||
    typeof ja !== "string" ||
    typeof en !== "string" ||
    typeof topic !== "string" ||
    typeof subtopic !== "string" ||
    !isInt(level) ||
    typeof reason !== "string" ||
    typeof deletedAt !== "string" ||
    (replacedBy !== undefined && typeof replacedBy !== "string")
  ) {
    return undefined;
  }
  /** @type {Tombstone} */
  const tombstone = { id, ja, en, topic, subtopic, level, reason, deletedAt };
  if (replacedBy !== undefined) tombstone.replacedBy = replacedBy;
  return tombstone;
}

/**
 * @param {string} root - Content root.
 * @returns {Tombstone[]} Every tombstone, in file order.
 * @throws {CardsError} `ERR_CARDS_TOMBSTONES` on a line that is not one.
 */
function loadTombstones(root) {
  const file = path.join(root, "tombstones.jsonl");
  if (!existsSync(file)) return [];
  /** @type {Tombstone[]} */
  const tombstones = [];
  for (const [index, line] of readFileSync(file, "utf8").split("\n").entries()) {
    if (line.trim() === "") continue;
    /** @type {Tombstone | undefined} */
    let tombstone;
    try {
      tombstone = asTombstone(parseJson(line));
    } catch {
      tombstone = undefined;
    }
    if (tombstone === undefined) {
      throw new CardsError("ERR_CARDS_TOMBSTONES", "A tombstone line is malformed.", {
        expected:
          "one JSON object per line with id, ja, en, topic, subtopic, level, reason, deletedAt",
        actual: `${displayPath(root, "tombstones.jsonl")} line ${String(index + 1)}`,
        next: "restore the file from git; tombstones are only ever appended by `pnpm cards:tombstone`.",
      });
    }
    tombstones.push(tombstone);
  }
  return tombstones;
}

/**
 * Load the whole content root.
 *
 * @param {string} root - Content root.
 * @returns {Store} Lists, cards and tombstones.
 * @throws {CardsError} When a list, a card file or the tombstone log cannot
 *   be read as JSON of the right outer shape.
 */
export function loadStore(root) {
  const lists = loadLists(root);
  /** @type {CardEntry[]} */
  const cards = [];
  /** @type {Map<string, Record<string, unknown>[]>} */
  const files = new Map();
  /** @type {string[]} */
  const strayFiles = [];
  const cardsDirectory = path.join(root, "cards");

  for (const file of listFiles(cardsDirectory, "")) {
    if (!/^[^/]+\/[^/]+\.json$/u.test(file)) {
      strayFiles.push(file);
      continue;
    }
    /** @type {unknown} */
    let parsed;
    try {
      parsed = parseJson(readFileSync(path.join(cardsDirectory, file), "utf8"));
    } catch (error) {
      parsed = error;
    }
    if (!Array.isArray(parsed)) {
      throw new CardsError("ERR_CARDS_CARD_FILE", "A card file is not a JSON array.", {
        expected: "a JSON array of card objects",
        actual: displayPath(root, `cards/${file}`),
        next: "restore the file from git; card files are written only by `pnpm cards:*`.",
      });
    }
    /** @type {Record<string, unknown>[]} */
    const records = [];
    for (const [index, value] of parsed.entries()) {
      /** @type {Record<string, unknown>} */
      const raw =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? /** @type {Record<string, unknown>} */ (value)
          : { value };
      records.push(raw);
      cards.push({ raw, file, index });
    }
    files.set(file, records);
  }
  return { root, lists, cards, files, strayFiles, tombstones: loadTombstones(root) };
}

/**
 * Put a card's keys in the one order every card file uses: `id`, the core
 * fields, declared optional fields, `createdAt`, `stamps`, then anything else
 * (kept so a malformed card loses nothing; lint reports it).
 *
 * @param {Record<string, unknown>} raw - A card.
 * @param {readonly string[]} optionalNames - Declared optional field names.
 * @returns {Record<string, unknown>} The same card with its keys reordered.
 */
export function orderCard(raw, optionalNames) {
  const order = ["id", ...CORE_FIELDS, ...optionalNames, "createdAt", "stamps"];
  /** @type {Record<string, unknown>} */
  const ordered = {};
  for (const key of order) {
    if (key in raw) ordered[key] = raw[key];
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in ordered)) ordered[key] = value;
  }
  return ordered;
}

/**
 * @param {Record<string, unknown>} raw - A card.
 * @returns {string} Its id, or an empty string, for sorting.
 */
export function sortKey(raw) {
  const id = raw["id"];
  return typeof id === "string" ? id : "";
}

/**
 * Order ids by code unit, never by locale, so the order a file is written in
 * and the order lint expects cannot disagree between machines.
 *
 * @param {string} left - One id.
 * @param {string} right - The other.
 * @returns {number} Negative, zero or positive.
 */
export function compareIds(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Formats written files so they are byte-identical to what the repository's
 * formatter produces, and `pnpm format:check` stays green.
 *
 * @callback Formatter
 * @param {readonly string[]} files - Absolute paths just written.
 * @returns {void}
 */

/**
 * Run the repository's Prettier over the given files.
 *
 * @remarks
 * Prettier collapses a short array onto one line and a hand-rolled serializer
 * would have to reimplement its width rules, CJK width included, to match.
 * Spawning the pinned Prettier with the repository's own config is the only
 * way the output is guaranteed to agree with `pnpm format:check` and the
 * pre-commit hook. The config is passed explicitly so a content root outside
 * the repository (a test's temp directory) is formatted identically.
 *
 * @type {Formatter}
 */
export function prettierFormatter(files) {
  if (files.length === 0) return;
  const bin = path.join(repoRoot, "node_modules", "prettier", "bin", "prettier.cjs");
  if (!existsSync(bin)) {
    throw new CardsError("ERR_CARDS_FORMATTER", "Prettier is not installed.", {
      expected: "node_modules/prettier/bin/prettier.cjs",
      actual: "missing",
      next: "run `pnpm install`, then rerun the command; the card files were written but not formatted.",
    });
  }
  const result = runNode(bin, [
    "--config",
    path.join(repoRoot, ".prettierrc.json"),
    "--write",
    "--log-level",
    "warn",
    ...files,
  ]);
  if (result.status !== 0) {
    throw new CardsError(
      "ERR_CARDS_FORMATTER",
      "Prettier failed on the written card files.",
      {
        expected: "exit status 0",
        actual:
          result.stderr.trim().split("\n")[0] ?? `exit status ${String(result.status)}`,
        next: "run `pnpm exec prettier --check content/cards` to see the failure, then `pnpm cards:lint`.",
      },
    );
  }
}

/**
 * Write card files, each sorted by id with canonical key order, deleting a
 * file left empty, then format what was written.
 *
 * @param {string} root - Content root.
 * @param {ReadonlyMap<string, readonly Record<string, unknown>[]>} files -
 *   Card arrays by path relative to `cards/`.
 * @param {readonly string[]} optionalNames - Declared optional field names.
 * @param {Formatter} format - Formatter for the written files.
 * @returns {void}
 */
export function writeCardFiles(root, files, optionalNames, format) {
  /** @type {string[]} */
  const written = [];
  for (const [file, records] of files) {
    const absolute = path.join(root, "cards", file);
    if (records.length === 0) {
      rmSync(absolute, { force: true });
      continue;
    }
    const sorted = [...records]
      .sort((left, right) => compareIds(sortKey(left), sortKey(right)))
      .map((raw) => orderCard(raw, optionalNames));
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, `${JSON.stringify(sorted, null, 2)}\n`);
    written.push(absolute);
  }
  format(written);
}

/**
 * Append tombstones to the log, one JSON object per line.
 *
 * @param {string} root - Content root.
 * @param {readonly Tombstone[]} tombstones - What to append.
 * @returns {void}
 */
export function appendTombstones(root, tombstones) {
  const text = tombstones.map((tombstone) => `${JSON.stringify(tombstone)}\n`).join("");
  appendFileSync(path.join(root, "tombstones.jsonl"), text);
}
