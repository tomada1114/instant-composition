// What every command shares once the content root is loaded: the injected
// context, a typed view of a stored card, and a card's review status.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseJson } from "../lib/json.mjs";
import { CardsError } from "./errors.mjs";
import { lintStore } from "./rules.mjs";
import { coreHash, readStamp } from "./schema.mjs";

/**
 * Everything a command reads from outside its arguments, injectable so a
 * test drives a command in-process against a temporary content root.
 *
 * @typedef {object} Context
 * @property {string} root - Content root.
 * @property {(text: string) => void} out - Standard output, one call per line.
 * @property {(text: string) => void} err - Standard error.
 * @property {() => string} today - Local date, `YYYY-MM-DD`.
 * @property {import("./store.mjs").Formatter} formatter - Formats written files.
 * @property {(max: number) => number} random - Integer in `[0, max)`.
 * @property {readonly import("./schema.mjs").OptionalField[]} optionalFields
 */

/**
 * A card whose core fields have the right types.
 *
 * @typedef {import("./schema.mjs").CoreFields & {
 *   id: string,
 *   stamps: unknown,
 *   raw: Record<string, unknown>,
 * }} TypedCard
 */

/**
 * Review status, in the order the default queue takes them.
 *
 * @typedef {"lint-error" | "unstamped" | "changed" | "outdated" | "current"} Status
 */

/** @type {readonly Status[]} */
export const STATUS_ORDER = [
  "lint-error",
  "unstamped",
  "changed",
  "outdated",
  "current",
];

/**
 * @param {unknown} value - Candidate.
 * @returns {value is string[]} True for an array of strings.
 */
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * @param {Record<string, unknown>} raw - A stored card.
 * @returns {TypedCard | undefined} The card, when its core fields are typed right.
 */
export function asTyped(raw) {
  const { id, ja, en, alternatives, point, topic, subtopic, level, grammar, stamps } =
    raw;
  if (
    typeof id !== "string" ||
    typeof ja !== "string" ||
    typeof en !== "string" ||
    typeof point !== "string" ||
    typeof topic !== "string" ||
    typeof subtopic !== "string" ||
    typeof level !== "number" ||
    !isStringArray(alternatives) ||
    !isStringArray(grammar)
  ) {
    return undefined;
  }
  return {
    id,
    ja,
    en,
    alternatives,
    point,
    topic,
    subtopic,
    level,
    grammar,
    stamps,
    raw,
  };
}

/**
 * @param {Record<string, unknown>} raw - A stored card.
 * @param {boolean} hasErrors - Whether lint reported an error for it.
 * @param {number} perspectivesVersion - The current version.
 * @returns {Status} Where the card stands in review.
 */
export function statusOf(raw, hasErrors, perspectivesVersion) {
  const card = asTyped(raw);
  if (hasErrors || card === undefined) return "lint-error";
  const stamp = readStamp(card.stamps, "core");
  if (stamp === undefined) return "unstamped";
  if (stamp.hash !== coreHash(card)) return "changed";
  if (stamp.perspectivesVersion < perspectivesVersion) return "outdated";
  return "current";
}

/**
 * @param {import("./store.mjs").Store} store - The loaded content root.
 * @param {Context} context - Declared fields.
 * @returns {Map<string, import("./rules.mjs").Finding[]>} Lint findings by card label.
 */
export function findingsByCard(store, context) {
  /** @type {Map<string, import("./rules.mjs").Finding[]>} */
  const byCard = new Map();
  for (const finding of lintStore(
    store,
    { lists: store.lists, optionalFields: context.optionalFields },
    undefined,
  )) {
    byCard.set(finding.id, [...(byCard.get(finding.id) ?? []), finding]);
  }
  return byCard;
}

/**
 * Find a stored card by id.
 *
 * @param {import("./store.mjs").Store} store - The loaded content root.
 * @param {string} id - Requested id.
 * @param {string} next - The next step to print for an unknown id.
 * @returns {import("./store.mjs").CardEntry} The entry.
 * @throws {CardsError} `ERR_CARDS_UNKNOWN_ID`.
 */
export function entryById(store, id, next) {
  const entry = store.cards.find((candidate) => candidate.raw["id"] === id);
  if (entry === undefined) {
    throw new CardsError("ERR_CARDS_UNKNOWN_ID", `No card has the id ${id}.`, {
      expected: "the id of a card under cards/",
      actual: store.tombstones.some((tombstone) => tombstone.id === id)
        ? `${id} is tombstoned`
        : `${id} does not exist`,
      next,
    });
  }
  return entry;
}

/**
 * @typedef {object} UnknownId
 * @property {string} id
 * @property {"tombstoned" | "does not exist"} reason
 */

/**
 * Split requested ids into the stored cards and the ids no card has, so one
 * stale or deleted id is reported on its own instead of failing the batch.
 *
 * @param {import("./store.mjs").Store} store - The loaded content root.
 * @param {readonly string[]} ids - Requested ids.
 * @returns {{ entries: import("./store.mjs").CardEntry[], unknown: UnknownId[] }}
 *   The entries in request order, and the ids that matched none.
 */
export function partitionIds(store, ids) {
  /** @type {import("./store.mjs").CardEntry[]} */
  const entries = [];
  /** @type {UnknownId[]} */
  const unknown = [];
  for (const id of ids) {
    const entry = store.cards.find((candidate) => candidate.raw["id"] === id);
    if (entry !== undefined) entries.push(entry);
    else {
      unknown.push({
        id,
        reason: store.tombstones.some((tombstone) => tombstone.id === id)
          ? "tombstoned"
          : "does not exist",
      });
    }
  }
  return { entries, unknown };
}

/**
 * Report ids that matched no card, one line each on stderr.
 *
 * @param {Context} context - Output sink.
 * @param {readonly UnknownId[]} unknown - The ids.
 * @returns {void}
 */
export function reportUnknown(context, unknown) {
  for (const { id, reason } of unknown) context.err(`unknown id ${id}: ${reason}`);
}

/**
 * Find stored cards by id, failing on the first unknown one.
 *
 * @param {import("./store.mjs").Store} store - The loaded content root.
 * @param {readonly string[]} ids - Requested ids.
 * @param {string} next - The next step to print for an unknown id.
 * @returns {import("./store.mjs").CardEntry[]} The entries, in request order.
 * @throws {CardsError} `ERR_CARDS_UNKNOWN_ID`.
 */
export function entriesById(store, ids, next) {
  return ids.map((id) => entryById(store, id, next));
}

/**
 * Read a JSON input file handed to a command.
 *
 * @param {string} file - Path as given, relative to the working directory.
 * @param {string} command - Command name, for the message.
 * @returns {unknown} The parsed value.
 * @throws {CardsError} `ERR_CARDS_INPUT` when unreadable or not JSON.
 */
export function readInput(file, command) {
  try {
    return parseJson(readFileSync(path.resolve(file), "utf8"));
  } catch (error) {
    throw new CardsError(
      "ERR_CARDS_INPUT",
      `The input file for cards:${command} could not be read.`,
      {
        expected: "a readable JSON file",
        actual: `${file}: ${error instanceof Error ? error.message : String(error)}`,
        next: "write the input as a JSON array (see the skill's brief) and rerun.",
        cause: error,
      },
    );
  }
}

/**
 * A stable pseudo-random rank for spreading ties: same input, same rank, on
 * every machine.
 *
 * @param {string} key - Anything identifying the item.
 * @returns {string} A hex string to compare.
 */
export function spreadRank(key) {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/**
 * @param {Date} date - A moment.
 * @returns {string} Its local calendar date, `YYYY-MM-DD`.
 */
export function localDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${month}-${day}`;
}
