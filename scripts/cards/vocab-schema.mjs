// The vocabulary card — the second content kind, under content/vocab/ — its
// shape, its hashes, and the rule that decides whether it is shown for a first
// language. Like schema.mjs, it reads no file, so the catalog build decides
// "shown" by exactly the rule `cards:stamp --kind vocab` stamps against.
import { readKey } from "../lib/json.mjs";
import { fieldHash, randomId, readStamp, sha256 } from "./schema.mjs";

/** The categories, each one file: `content/vocab/<category>.json`. */
export const VOCAB_CATEGORIES = /** @type {const} */ ([
  "word",
  "idiom",
  "phrasal-verb",
  "phrase",
]);

/**
 * The fields a vocabulary card's `stamps.core` hash covers, in the order they
 * are serialized. Changing this list or its order hides every vocabulary card
 * until it is stamped again.
 */
export const VOCAB_CORE_FIELDS = /** @type {const} */ ([
  "category",
  "level",
  "headword",
  "definition",
  "example",
  "example2",
]);

/**
 * The first languages a card's `meanings` may hold. Each meaning is stamped
 * on its own, under `stamps["meanings.<lang>"]`, so a meaning added for a new
 * language never hides the card from the languages already reviewed.
 */
export const VOCAB_LANGUAGES = /** @type {const} */ (["ja"]);

/** A vocabulary card id: `v_` then four digit-letter pairs, e.g. `v_7k2m9x4q`. */
export const VOCAB_ID_PATTERN = /^v_(?:[2-9][a-hjkmnp-z]){4}$/u;

/**
 * @typedef {object} VocabCore
 * @property {string} category
 * @property {number} level
 * @property {string} headword
 * @property {string} definition
 * @property {string} example
 * @property {string} example2
 */

/**
 * A vocabulary card whose core fields have the right types.
 *
 * @typedef {VocabCore & {
 *   id: string,
 *   meanings: Record<string, string>,
 *   stamps: unknown,
 *   raw: Record<string, unknown>,
 * }} TypedVocab
 */

/**
 * Draw one random vocabulary card id. Uniqueness is the caller's job.
 *
 * @param {(max: number) => number} random - Returns an integer in `[0, max)`.
 * @returns {string} A fresh id matching {@link VOCAB_ID_PATTERN}.
 */
export function randomVocabId(random) {
  return randomId(random, "v_");
}

/**
 * @param {string} lang - A language in {@link VOCAB_LANGUAGES}.
 * @returns {string} The key its meaning is stamped under.
 */
export function meaningStamp(lang) {
  return `meanings.${lang}`;
}

/**
 * The exact string the core hash is taken over: `JSON.stringify` of an object
 * holding the core fields in {@link VOCAB_CORE_FIELDS} order, and nothing else.
 *
 * @param {VocabCore} card - A card, or anything carrying its core fields.
 * @returns {string} The canonical serialization.
 */
export function canonicalVocabCore(card) {
  return JSON.stringify({
    category: card.category,
    level: card.level,
    headword: card.headword,
    definition: card.definition,
    example: card.example,
    example2: card.example2,
  });
}

/**
 * @param {VocabCore} card - A card.
 * @returns {string} The hash `stamps.core.hash` must equal for it to be shown.
 */
export function vocabCoreHash(card) {
  return sha256(canonicalVocabCore(card));
}

/**
 * @param {unknown} meanings - A card's `meanings` value.
 * @param {string} lang - A first language.
 * @returns {string | undefined} The meaning in that language, when there is one.
 */
export function meaningOf(meanings, lang) {
  const meaning = readKey(meanings, lang);
  return typeof meaning === "string" ? meaning : undefined;
}

/**
 * The rule a vocabulary card is shown to a learner whose first language is
 * `l1` by: its core stamp matches its core fields, and its meaning in `l1`
 * exists and its own stamp matches it. A stamp from an older
 * `perspectivesVersion` still counts, as it does for a drill card.
 *
 * @param {VocabCore & { meanings: unknown, stamps: unknown }} card - A card.
 * @param {string} l1 - The learner's first language.
 * @returns {boolean} True when the card and its `l1` meaning were reviewed as
 *   they stand.
 */
export function isVocabShown(card, l1) {
  if (readStamp(card.stamps, "core")?.hash !== vocabCoreHash(card)) return false;
  const meaning = meaningOf(card.meanings, l1);
  return (
    meaning !== undefined &&
    readStamp(card.stamps, meaningStamp(l1))?.hash === fieldHash(meaning)
  );
}

/**
 * @param {unknown} value - Candidate.
 * @returns {value is Record<string, string>} True for an object of strings.
 */
function isStringRecord(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

/**
 * @param {Record<string, unknown>} raw - A stored vocabulary card.
 * @returns {TypedVocab | undefined} The card, when its core fields and
 *   meanings are typed right.
 */
export function asTypedVocab(raw) {
  const { id, category, level, headword, definition, example, example2, meanings } =
    raw;
  if (
    typeof id !== "string" ||
    typeof category !== "string" ||
    typeof level !== "number" ||
    typeof headword !== "string" ||
    typeof definition !== "string" ||
    typeof example !== "string" ||
    typeof example2 !== "string" ||
    !isStringRecord(meanings)
  ) {
    return undefined;
  }
  return {
    id,
    category,
    level,
    headword,
    definition,
    example,
    example2,
    meanings,
    stamps: raw["stamps"],
    raw,
  };
}

/**
 * Review status, in the order the default queue takes them; the same
 * vocabulary as a drill card's.
 *
 * @typedef {import("./common.mjs").Status} Status
 */

/** @type {readonly Status[]} */
const ORDER = ["lint-error", "unstamped", "changed", "outdated", "current"];

/**
 * @param {unknown} stamps - The card's `stamps`.
 * @param {string} name - The stamp to read.
 * @param {string} hash - What it must hold to be current.
 * @param {number} perspectivesVersion - The current version.
 * @returns {Status} Where that one stamp stands.
 */
function stampStatus(stamps, name, hash, perspectivesVersion) {
  const stamp = readStamp(stamps, name);
  if (stamp === undefined) return "unstamped";
  if (stamp.hash !== hash) return "changed";
  if (stamp.perspectivesVersion < perspectivesVersion) return "outdated";
  return "current";
}

/**
 * Where a vocabulary card stands in review: the least reviewed of its core
 * and each meaning it holds.
 *
 * @param {Record<string, unknown>} raw - A stored vocabulary card.
 * @param {boolean} hasErrors - Whether lint reported an error for it.
 * @param {number} perspectivesVersion - The current version.
 * @returns {Status} Its status.
 */
export function vocabStatusOf(raw, hasErrors, perspectivesVersion) {
  const card = asTypedVocab(raw);
  if (hasErrors || card === undefined) return "lint-error";
  const statuses = [
    stampStatus(card.stamps, "core", vocabCoreHash(card), perspectivesVersion),
    ...Object.entries(card.meanings).map(([lang, meaning]) =>
      stampStatus(
        card.stamps,
        meaningStamp(lang),
        fieldHash(meaning),
        perspectivesVersion,
      ),
    ),
  ];
  return ORDER.find((status) => statuses.includes(status)) ?? "current";
}
