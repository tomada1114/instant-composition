// The card shape, its hash, and the rule that decides whether a card is shown.
//
// This is the one module the app is meant to reuse as-is when it exists: the
// app must decide "is this card shown" by exactly the rule the review
// tooling stamps against, or a reviewed card could stay hidden (or an edited,
// unreviewed one appear). Keep it free of filesystem access and of anything
// beyond `node:crypto` and the JSON narrowing helper.
import { createHash, randomInt } from "node:crypto";

import { readKey } from "../lib/json.mjs";

/**
 * The fields a card's `stamps.core` hash covers, in the order they are
 * serialized. Changing this list or its order changes every hash and hides
 * every card until it is stamped again.
 */
export const CORE_FIELDS = /** @type {const} */ ([
  "ja",
  "en",
  "alternatives",
  "point",
  "topic",
  "subtopic",
  "level",
  "grammar",
]);

/**
 * @typedef {object} OptionalField
 * @property {string} name - Key on the card, and the key of its stamp.
 * @property {(value: unknown) => string | undefined} check - Returns what is
 *   wrong with a value, or undefined when it is valid.
 */

/**
 * The optional fields a card may carry beyond the core. Each one is filled by
 * `backfilling-card-fields` and stamped separately under `stamps.<name>`, so
 * adding one never hides a card. A key on a card that is neither core, nor
 * `id`/`createdAt`/`stamps`, nor listed here fails lint.
 *
 * @type {readonly OptionalField[]}
 */
export const OPTIONAL_FIELDS = [];

/**
 * @typedef {object} Stamp
 * @property {string} hash - `sha256:<hex>` of what was reviewed.
 * @property {number} perspectivesVersion - Review perspectives in force.
 * @property {string} at - Local date of the review, `YYYY-MM-DD`.
 */

/**
 * @typedef {object} CoreFields
 * @property {string} ja
 * @property {string} en
 * @property {readonly string[]} alternatives
 * @property {string} point
 * @property {string} topic
 * @property {string} subtopic
 * @property {number} level
 * @property {readonly string[]} grammar
 */

// Digits and letters alternate so that no two letters are ever adjacent: the
// repository's spell checker splits identifiers at digits and flags two- and
// three-letter runs ("ba", "bck") as misspellings, and a single letter is
// never one. 0/1 and i/l/o are left out as look-alikes.
const ID_DIGITS = "23456789";
const ID_LETTERS = "abcdefghjkmnpqrstuvwxyz";

/** A card id: `c_` then four digit-letter pairs, e.g. `c_7k2m9x4q`. */
export const ID_PATTERN = /^c_(?:[2-9][a-hjkmnp-z]){4}$/u;

/**
 * Draw one random card id. Uniqueness is the caller's job.
 *
 * @param {(max: number) => number} [random] - Returns an integer in `[0, max)`.
 * @returns {string} A fresh id matching {@link ID_PATTERN}.
 */
export function randomId(random = randomInt) {
  let id = "c_";
  for (let pair = 0; pair < 4; pair += 1) {
    id += ID_DIGITS.charAt(random(ID_DIGITS.length));
    id += ID_LETTERS.charAt(random(ID_LETTERS.length));
  }
  return id;
}

/**
 * @param {string} text - Canonical serialization.
 * @returns {string} `sha256:<hex>` of the UTF-8 bytes.
 */
function sha256(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/**
 * The exact string the core hash is taken over: `JSON.stringify` of an object
 * holding the core fields in {@link CORE_FIELDS} order, and nothing else.
 *
 * @param {CoreFields} card - A card, or anything carrying its core fields.
 * @returns {string} The canonical serialization.
 */
export function canonicalCore(card) {
  return JSON.stringify({
    ja: card.ja,
    en: card.en,
    alternatives: card.alternatives,
    point: card.point,
    topic: card.topic,
    subtopic: card.subtopic,
    level: card.level,
    grammar: card.grammar,
  });
}

/**
 * @param {CoreFields} card - A card.
 * @returns {string} The hash `stamps.core.hash` must equal for it to be shown.
 */
export function coreHash(card) {
  return sha256(canonicalCore(card));
}

/**
 * @param {unknown} value - A backfilled field's value.
 * @returns {string} The hash `stamps.<name>.hash` must equal.
 */
export function fieldHash(value) {
  return sha256(JSON.stringify(value));
}

/**
 * Read one stamp off a card's `stamps` object.
 *
 * @param {unknown} stamps - The card's `stamps` value.
 * @param {string} name - `core` or an optional field's name.
 * @returns {Stamp | undefined} The stamp, when it has the right shape.
 */
export function readStamp(stamps, name) {
  const stamp = readKey(stamps, name);
  const hash = readKey(stamp, "hash");
  const version = readKey(stamp, "perspectivesVersion");
  const at = readKey(stamp, "at");
  if (
    typeof hash !== "string" ||
    typeof version !== "number" ||
    typeof at !== "string"
  ) {
    return undefined;
  }
  return { hash, perspectivesVersion: version, at };
}

/**
 * The rule the app shows a card by: its core stamp matches its current core
 * fields. A stamp from an older `perspectivesVersion` still counts — the card
 * is re-queued for review, not hidden.
 *
 * @param {CoreFields & { stamps: unknown }} card - A card.
 * @returns {boolean} True when the card has been reviewed as it stands.
 */
export function isShown(card) {
  return readStamp(card.stamps, "core")?.hash === coreHash(card);
}
