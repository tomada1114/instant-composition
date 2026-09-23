// Argument parsing shared by every `cards:*` command: flags, the range
// filters (`topic=`, `subtopic=`, `level=`), and card id lists.
import { readKey } from "../lib/json.mjs";
import { CardsError } from "./errors.mjs";

/**
 * @typedef {"boolean" | "string" | "int" | "ids"} FlagKind
 */

/**
 * @typedef {object} CommandSpec
 * @property {string} usage - One-line synopsis after `pnpm cards:<name>`.
 * @property {Record<string, FlagKind>} flags - Accepted flags, without `--`.
 * @property {boolean} range - Whether range filters are accepted.
 * @property {number} positionals - How many bare arguments are accepted.
 */

/**
 * @typedef {object} Range
 * @property {string[]} [topics]
 * @property {{ topic: string, subtopic: string }} [subtopic]
 * @property {{ min: number, max: number }} [levels]
 */

/**
 * @typedef {object} Parsed
 * @property {Map<string, string | number | boolean | string[]>} flags
 * @property {Range} range
 * @property {string[]} positionals
 */

/**
 * @param {string} command - Command name.
 * @param {CommandSpec} spec - Its spec.
 * @param {string} actual - What was wrong.
 * @returns {CardsError} A usage error.
 */
export function usageError(command, spec, actual) {
  return new CardsError("ERR_CARDS_USAGE", `Invalid arguments for cards:${command}.`, {
    expected: `pnpm cards:${command} ${spec.usage}`,
    actual,
    next: `rerun as \`pnpm cards:${command} ${spec.usage}\`.`,
  });
}

/**
 * @param {string} value - Text such as `4` or `4-6`.
 * @returns {{ min: number, max: number } | undefined} The range, when valid.
 */
export function parseLevelRange(value) {
  const match = /^(\d+)(?:-(\d+))?$/u.exec(value);
  if (match === null) return undefined;
  const min = Number(match[1]);
  const max = match[2] === undefined ? min : Number(match[2]);
  return min >= 1 && max <= 10 && min <= max ? { min, max } : undefined;
}

/**
 * @param {string} value - Comma- or whitespace-separated ids.
 * @returns {string[]} The non-empty ids.
 */
function splitIds(value) {
  return value.split(/[\s,]+/u).filter((id) => id !== "");
}

/**
 * Parse a command's arguments against its spec.
 *
 * @param {string} command - Command name, for messages.
 * @param {CommandSpec} spec - What the command accepts.
 * @param {readonly string[]} argv - Arguments after the command name.
 * @returns {Parsed} Flags, range and positionals.
 * @throws {CardsError} `ERR_CARDS_USAGE` on anything the spec does not accept.
 */
export function parseArgs(command, spec, argv) {
  /** @type {Parsed} */
  const parsed = { flags: new Map(), range: {}, positionals: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token.startsWith("--")) {
      const [name = "", inline] = token.slice(2).split(/=(.*)/su);
      const kind = spec.flags[name];
      if (kind === undefined) throw usageError(command, spec, `unknown flag --${name}`);
      if (kind === "boolean") {
        if (inline !== undefined)
          throw usageError(command, spec, `--${name} takes no value`);
        parsed.flags.set(name, true);
        continue;
      }
      let value = inline;
      if (value === undefined) {
        index += 1;
        value = argv[index];
      }
      if (value === undefined || value.startsWith("--")) {
        throw usageError(command, spec, `--${name} needs a value`);
      }
      if (kind === "int") {
        if (!/^\d+$/u.test(value) || Number(value) < 1) {
          throw usageError(
            command,
            spec,
            `--${name} must be a positive integer, got "${value}"`,
          );
        }
        parsed.flags.set(name, Number(value));
      } else if (kind === "ids") {
        const ids = splitIds(value);
        // `--ids c_a c_b` as well as `--ids c_a,c_b`: take following bare ids.
        while (argv[index + 1]?.startsWith("c_") === true) {
          index += 1;
          ids.push(...splitIds(argv[index] ?? ""));
        }
        const previous = parsed.flags.get(name);
        parsed.flags.set(name, [...(Array.isArray(previous) ? previous : []), ...ids]);
      } else {
        parsed.flags.set(name, value);
      }
      continue;
    }
    const range = /^(topic|subtopic|level)=(.*)$/u.exec(token);
    if (range !== null) {
      if (!spec.range)
        throw usageError(command, spec, `range filter "${token}" is not accepted`);
      const [, key, value = ""] = range;
      if (key === "topic") {
        parsed.range.topics = splitIds(value);
      } else if (key === "subtopic") {
        const [topic = "", subtopic = "", extra] = value.split("/");
        if (topic === "" || subtopic === "" || extra !== undefined) {
          throw usageError(
            command,
            spec,
            `subtopic= needs <topic>/<subtopic>, got "${value}"`,
          );
        }
        parsed.range.subtopic = { topic, subtopic };
      } else {
        const levels = parseLevelRange(value);
        if (levels === undefined) {
          throw usageError(
            command,
            spec,
            `level= needs <n> or <n>-<m> within 1–10, got "${value}"`,
          );
        }
        parsed.range.levels = levels;
      }
      continue;
    }
    parsed.positionals.push(token);
  }
  if (parsed.positionals.length > spec.positionals) {
    throw usageError(
      command,
      spec,
      `unexpected argument "${parsed.positionals[spec.positionals] ?? ""}"`,
    );
  }
  return parsed;
}

/**
 * @param {Parsed} parsed - Parsed arguments.
 * @param {string} name - Flag name.
 * @returns {boolean} Whether a boolean flag was given.
 */
export function flag(parsed, name) {
  return parsed.flags.get(name) === true;
}

/**
 * @param {Parsed} parsed - Parsed arguments.
 * @param {string} name - Flag name.
 * @returns {string | undefined} A string flag's value.
 */
export function stringFlag(parsed, name) {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

/**
 * @param {Parsed} parsed - Parsed arguments.
 * @param {string} name - Flag name.
 * @returns {number | undefined} An integer flag's value.
 */
export function intFlag(parsed, name) {
  const value = parsed.flags.get(name);
  return typeof value === "number" ? value : undefined;
}

/**
 * @param {Parsed} parsed - Parsed arguments.
 * @param {string} name - Flag name.
 * @returns {string[] | undefined} An id-list flag's value.
 */
export function idsFlag(parsed, name) {
  const value = parsed.flags.get(name);
  return Array.isArray(value) ? value : undefined;
}

/**
 * @param {Range} range - Parsed range.
 * @returns {boolean} True when no filter was given.
 */
export function isEmptyRange(range) {
  return (
    range.topics === undefined &&
    range.subtopic === undefined &&
    range.levels === undefined
  );
}

/**
 * @param {Range} range - Parsed range.
 * @param {Readonly<Record<string, unknown>>} cell - A card, tombstone or cell.
 * @returns {boolean} True when the cell is inside every given filter.
 */
export function inRange(range, cell) {
  const topic = readKey(cell, "topic");
  const level = readKey(cell, "level");
  if (range.topics !== undefined && !range.topics.includes(String(topic))) return false;
  if (
    range.subtopic !== undefined &&
    (topic !== range.subtopic.topic ||
      readKey(cell, "subtopic") !== range.subtopic.subtopic)
  ) {
    return false;
  }
  if (range.levels !== undefined) {
    if (
      typeof level !== "number" ||
      level < range.levels.min ||
      level > range.levels.max
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Reject a range naming a topic or subtopic the taxonomy does not have.
 *
 * @param {string} command - Command name.
 * @param {CommandSpec} spec - Its spec.
 * @param {Range} range - Parsed range.
 * @param {readonly import("./store.mjs").Topic[]} topics - The taxonomy.
 * @returns {void}
 * @throws {CardsError} `ERR_CARDS_USAGE` for an unknown id.
 */
export function checkRange(command, spec, range, topics) {
  for (const topic of range.topics ?? []) {
    if (!topics.some((entry) => entry.id === topic)) {
      throw usageError(command, spec, `topic "${topic}" is not in taxonomy.json`);
    }
  }
  if (range.subtopic !== undefined) {
    const { topic, subtopic } = range.subtopic;
    const known = topics.find((entry) => entry.id === topic);
    if (known?.subtopics.some((entry) => entry.id === subtopic) !== true) {
      throw usageError(
        command,
        spec,
        `subtopic "${topic}/${subtopic}" is not in taxonomy.json`,
      );
    }
  }
}
