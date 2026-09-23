// The lint rules. Every rule here is an ERROR: a card that fails one is never
// stamped, and `cards:add` drops it. A finding is `{ id, rule, message }`,
// printed as `<id> <RULE> <message>`.
import { readKey } from "../lib/json.mjs";
import { CORE_FIELDS, ID_PATTERN, readStamp } from "./schema.mjs";
import { cardFile, compareIds, sortKey } from "./store.mjs";
import {
  countWords,
  endsAsSentence,
  hasEllipsis,
  hasJapanese,
  normalizeEn,
  unexpectedLatinWords,
} from "./text.mjs";

/** The longest `point` allowed, in characters. */
export const POINT_MAX_LENGTH = 60;

const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;

/**
 * @typedef {object} Finding
 * @property {string} id - The card id, or where the problem is when there is
 *   no usable id (`<file>#<index>`, `grammar:<id>`).
 * @property {string} rule - Stable rule name, e.g. `WORD_COUNT`.
 * @property {string} message - What is wrong.
 */

/**
 * @typedef {object} LintEnv
 * @property {import("./store.mjs").Lists} lists
 * @property {readonly import("./schema.mjs").OptionalField[]} optionalFields
 */

/**
 * @param {unknown} value - Candidate.
 * @returns {value is string[]} True for an array of strings.
 */
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Check the shape of every field. Returns early findings only; the content
 * rules below run on what has the right type.
 *
 * @param {Record<string, unknown>} raw - A card.
 * @param {string} id - How findings name it.
 * @param {LintEnv} env - Lists and declared fields.
 * @param {{ requireStored: boolean }} options - Whether `id`, `createdAt`
 *   and `stamps` must be present (false for a card not yet admitted).
 * @returns {Finding[]} Shape findings.
 */
function shapeFindings(raw, id, env, options) {
  /** @type {Finding[]} */
  const findings = [];
  const add = (/** @type {string} */ message) => {
    findings.push({ id, rule: "SHAPE", message });
  };
  const optionalNames = env.optionalFields.map((field) => field.name);
  const known = new Set([
    "id",
    ...CORE_FIELDS,
    "createdAt",
    "stamps",
    ...optionalNames,
  ]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) add(`unknown key "${key}"`);
  }
  for (const key of ["ja", "en", "point", "topic", "subtopic"]) {
    const value = raw[key];
    if (typeof value !== "string" || value.trim() === "")
      add(`"${key}" must be a non-empty string`);
  }
  if (typeof raw["level"] !== "number" || !Number.isInteger(raw["level"])) {
    add('"level" must be an integer');
  }
  if (!isStringArray(raw["alternatives"]))
    add('"alternatives" must be an array of strings');
  if (!isStringArray(raw["grammar"])) add('"grammar" must be an array of strings');
  if (options.requireStored) {
    if (typeof raw["id"] !== "string" || !ID_PATTERN.test(raw["id"])) {
      findings.push({
        id,
        rule: "ID_FORMAT",
        message: `"id" must match ${ID_PATTERN.source}`,
      });
    }
    if (typeof raw["createdAt"] !== "string" || !DATE.test(raw["createdAt"])) {
      add('"createdAt" must be a YYYY-MM-DD date');
    }
    const stamps = raw["stamps"];
    if (typeof stamps !== "object" || stamps === null || Array.isArray(stamps)) {
      add('"stamps" must be an object');
    } else {
      for (const name of Object.keys(stamps)) {
        const stamp = readStamp(stamps, name);
        if (name !== "core" && !optionalNames.includes(name)) {
          add(`stamp "${name}" names no declared field`);
        } else if (
          stamp === undefined ||
          !HASH.test(stamp.hash) ||
          !DATE.test(stamp.at)
        ) {
          add(
            `stamp "${name}" must be { hash: "sha256:<hex>", perspectivesVersion, at }`,
          );
        }
      }
    }
  }
  for (const field of env.optionalFields) {
    if (field.name in raw) {
      const problem = field.check(raw[field.name]);
      if (problem !== undefined) {
        findings.push({ id, rule: "FIELD", message: `"${field.name}": ${problem}` });
      }
    }
  }
  return findings;
}

/**
 * Lint one card on its own: everything except uniqueness, tombstones and
 * which file it sits in.
 *
 * @param {Record<string, unknown>} raw - A card.
 * @param {string} id - How findings name it.
 * @param {LintEnv} env - Lists and declared fields.
 * @param {{ requireStored: boolean }} options - See {@link shapeFindings}.
 * @returns {Finding[]} Every finding.
 */
export function lintCard(raw, id, env, options) {
  const findings = shapeFindings(raw, id, env, options);
  const add = (/** @type {string} */ rule, /** @type {string} */ message) => {
    findings.push({ id, rule, message });
  };
  const { ja, en, point, topic, subtopic, level, alternatives, grammar } = raw;

  if (typeof topic === "string" && typeof subtopic === "string") {
    const known = env.lists.topics.find((entry) => entry.id === topic);
    if (known === undefined) {
      add("TAXONOMY", `topic "${topic}" is not in taxonomy.json`);
    } else if (!known.subtopics.some((entry) => entry.id === subtopic)) {
      add("TAXONOMY", `subtopic "${topic}/${subtopic}" is not in taxonomy.json`);
    }
  }

  const levelEntry =
    typeof level === "number" ? env.lists.levels.get(level) : undefined;
  if (typeof level === "number" && levelEntry === undefined) {
    add("LEVEL", `level ${String(level)} is not in levels.json`);
  }

  if (typeof en === "string") {
    if (levelEntry !== undefined) {
      const words = countWords(en);
      const { min, max } = levelEntry.words;
      if (words < min || words > max) {
        add(
          "WORD_COUNT",
          `"en" has ${String(words)} words; level ${String(levelEntry.level)} allows ${String(min)}–${String(max)}`,
        );
      }
    }
  }

  const english = [
    ...(typeof en === "string" ? [["en", en]] : []),
    ...(isStringArray(alternatives)
      ? alternatives.map((text, index) => [`alternatives[${String(index)}]`, text])
      : []),
  ];
  for (const [label = "", text = ""] of english) {
    if (hasJapanese(text))
      add("JAPANESE_IN_EN", `${label} contains Japanese characters`);
    if (!endsAsSentence(text))
      add("END_PUNCTUATION", `${label} must end with ".", "?" or "!"`);
  }

  if (typeof ja === "string") {
    const words = unexpectedLatinWords(ja);
    if (words.length > 0) {
      add(
        "LATIN_IN_JA",
        `"ja" contains ${words.map((word) => `"${word}"`).join(", ")}; Latin letters in ja are for names, acronyms and units only`,
      );
    }
  }

  for (const [label = "", text = ""] of [
    ...(typeof ja === "string" ? [["ja", ja]] : []),
    ...english,
    ...(typeof point === "string" ? [["point", point]] : []),
  ]) {
    if (hasEllipsis(text)) add("ELLIPSIS", `${label} contains "..." or "…"`);
  }

  if (isStringArray(alternatives)) {
    if (alternatives.length < 2 || alternatives.length > 3) {
      add(
        "ALTERNATIVES_COUNT",
        `${String(alternatives.length)} alternatives; expected 2–3`,
      );
    }
    /** @type {string[]} */
    const seen = typeof en === "string" ? [normalizeEn(en)] : [];
    for (const [index, text] of alternatives.entries()) {
      const normalized = normalizeEn(text);
      if (seen.includes(normalized)) {
        add(
          "ALTERNATIVE_TRIVIAL",
          `alternatives[${String(index)}] differs from "en" or another alternative only in case, punctuation or contractions`,
        );
      }
      seen.push(normalized);
    }
  }

  if (typeof point === "string") {
    if (/[\r\n]/u.test(point)) add("POINT", '"point" must be one line');
    const length = Array.from(point).length;
    if (length > POINT_MAX_LENGTH) {
      add(
        "POINT",
        `"point" is ${String(length)} characters; at most ${String(POINT_MAX_LENGTH)}`,
      );
    }
  }

  if (isStringArray(grammar)) {
    if (grammar.length < 1 || grammar.length > 2) {
      add("GRAMMAR_COUNT", `${String(grammar.length)} grammar ids; expected 1–2`);
    }
    if (new Set(grammar).size !== grammar.length)
      add("GRAMMAR_COUNT", "a grammar id is repeated");
    for (const grammarId of grammar) {
      const item = env.lists.grammarById.get(grammarId);
      if (item === undefined) {
        add("GRAMMAR_UNKNOWN", `grammar "${grammarId}" is not in grammar.json`);
      } else if (
        typeof level === "number" &&
        (level < item.minLevel || level > item.maxLevel)
      ) {
        add(
          "GRAMMAR_LEVEL",
          `grammar "${grammarId}" covers levels ${String(item.minLevel)}–${String(item.maxLevel)}, not ${String(level)}`,
        );
      }
    }
  }
  return findings;
}

/**
 * Sanity-check the grammar list against the level list: every example is a
 * sentence that could itself be a card at one of the item's levels.
 *
 * @param {import("./store.mjs").Lists} lists - Validated lists.
 * @returns {Finding[]} One finding per example that could not be.
 */
export function lintGrammarExamples(lists) {
  /** @type {Finding[]} */
  const findings = [];
  for (const item of lists.grammar) {
    const words = countWords(item.example);
    let fits = false;
    for (let level = item.minLevel; level <= item.maxLevel; level += 1) {
      const range = lists.levels.get(level)?.words;
      if (range !== undefined && words >= range.min && words <= range.max) fits = true;
    }
    const id = `grammar:${item.id}`;
    if (!fits) {
      findings.push({
        id,
        rule: "GRAMMAR_EXAMPLE",
        message: `example has ${String(words)} words, outside every level ${String(item.minLevel)}–${String(item.maxLevel)} range`,
      });
    }
    if (
      !endsAsSentence(item.example) ||
      hasJapanese(item.example) ||
      hasEllipsis(item.example)
    ) {
      findings.push({
        id,
        rule: "GRAMMAR_EXAMPLE",
        message:
          "example must be an English sentence ending in . ? or ! without ellipsis",
      });
    }
  }
  return findings;
}

/**
 * @param {import("./store.mjs").CardEntry} entry - A stored card.
 * @returns {string} How findings name it: its id, or `<file>#<index>`.
 */
export function entryLabel(entry) {
  const id = readKey(entry.raw, "id");
  return typeof id === "string" && id !== ""
    ? id
    : `${entry.file}#${String(entry.index)}`;
}

/**
 * Lint the stored cards: each card on its own, plus uniqueness, tombstoned
 * ids, file placement and file order.
 *
 * @param {import("./store.mjs").Store} store - The loaded content root.
 * @param {LintEnv} env - Lists and declared fields.
 * @param {ReadonlySet<string> | undefined} only - Restrict to these ids.
 * @returns {Finding[]} Every finding.
 */
export function lintStore(store, env, only) {
  /** @type {Finding[]} */
  const findings = [];
  const tombstoned = new Set(store.tombstones.map((tombstone) => tombstone.id));
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const entry of store.cards) {
    const id = sortKey(entry.raw);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  for (const entry of store.cards) {
    const id = entryLabel(entry);
    if (only !== undefined && !only.has(id)) continue;
    findings.push(...lintCard(entry.raw, id, env, { requireStored: true }));
    if (sortKey(entry.raw) !== "" && (counts.get(sortKey(entry.raw)) ?? 0) > 1) {
      findings.push({
        id,
        rule: "ID_DUPLICATE",
        message: "another card has the same id",
      });
    }
    if (tombstoned.has(id)) {
      findings.push({
        id,
        rule: "ID_TOMBSTONED",
        message: "this id is in tombstones.jsonl",
      });
    }
    const { topic, subtopic } = entry.raw;
    if (
      typeof topic === "string" &&
      typeof subtopic === "string" &&
      cardFile(topic, subtopic) !== entry.file
    ) {
      findings.push({
        id,
        rule: "FILE_LOCATION",
        message: `sits in cards/${entry.file}; its tags say cards/${cardFile(topic, subtopic)}`,
      });
    }
  }

  if (only === undefined) {
    for (const [file, records] of store.files) {
      for (let index = 1; index < records.length; index += 1) {
        const previous = records[index - 1];
        const current = records[index];
        if (
          previous !== undefined &&
          current !== undefined &&
          compareIds(sortKey(previous), sortKey(current)) > 0
        ) {
          findings.push({
            id: `${file}#${String(index)}`,
            rule: "FILE_ORDER",
            message: `cards/${file} is not sorted by id`,
          });
          break;
        }
      }
    }
    for (const file of store.strayFiles) {
      findings.push({
        id: `cards/${file}`,
        rule: "FILE_LOCATION",
        message: "not at cards/<topic>/<subtopic>.json",
      });
    }
    findings.push(...lintGrammarExamples(env.lists));
  }
  return findings;
}
