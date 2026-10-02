// The lint rules for vocabulary cards, and every limit they apply. As for the
// drill (rules.mjs), each rule is an ERROR: a card that fails one is never
// stamped, and `cards:add --kind vocab` drops it.
import { readKey } from "../lib/json.mjs";
import { readStamp } from "./schema.mjs";
import { compareIds, sortKey, vocabFile } from "./store.mjs";
import {
  countJaChars,
  countWords,
  endsAsSentence,
  hasEllipsis,
  hasJapanese,
  hasSecondSentenceEn,
  normalizeEn,
} from "./text.mjs";
import {
  meaningStamp,
  VOCAB_CATEGORIES,
  VOCAB_CORE_FIELDS,
  VOCAB_ID_PATTERN,
  VOCAB_LANGUAGES,
} from "./vocab-schema.mjs";

/**
 * Every limit the vocabulary lint applies, in one place. These are starting
 * values, tuned by use (#374 § Open questions).
 */
export const VOCAB_LIMITS = /** @type {const} */ ({
  /** `headword`, in words. */
  headword: { min: 1, max: 6 },
  /** `definition`, one sentence of at most this many words. */
  definitionWords: 15,
  /** `example`, at most this many words a line (a dialogue's `A:` uncounted). */
  exampleWords: 15,
  /** `example2`, at most this many words a line. */
  example2Words: 15,
  /** Each meaning's cap in characters, by language; whitespace uncounted. */
  meaningChars: { ja: 20 },
});

/** The category whose example is a two-line dialogue, `A: …` / `B: …`. */
const DIALOGUE_CATEGORY = "phrase";

const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const BLANK = /\{\{([^{}]*)\}\}/gu;
const SPEAKERS = ["A", "B"];

/**
 * Irregular forms of the words a headword is most often built on: verbs,
 * plurals and comparatives. A blanked word is a form of a headword word when
 * it is the word itself, a regular inflection of it, or listed here.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const IRREGULAR = {
  be: ["am", "is", "are", "was", "were", "been", "being"],
  have: ["has", "had"],
  do: ["does", "did", "done"],
  go: ["goes", "went", "gone"],
  give: ["gave", "given"],
  get: ["got", "gotten"],
  take: ["took", "taken"],
  make: ["made"],
  come: ["came"],
  become: ["became"],
  break: ["broke", "broken"],
  bring: ["brought"],
  buy: ["bought"],
  catch: ["caught"],
  think: ["thought"],
  teach: ["taught"],
  fight: ["fought"],
  seek: ["sought"],
  feel: ["felt"],
  keep: ["kept"],
  sleep: ["slept"],
  leave: ["left"],
  mean: ["meant"],
  deal: ["dealt"],
  meet: ["met"],
  lose: ["lost"],
  send: ["sent"],
  spend: ["spent"],
  lend: ["lent"],
  build: ["built"],
  run: ["ran"],
  sit: ["sat"],
  win: ["won"],
  hold: ["held"],
  find: ["found"],
  tell: ["told"],
  sell: ["sold"],
  say: ["said"],
  pay: ["paid"],
  lay: ["laid"],
  hear: ["heard"],
  see: ["saw", "seen"],
  fall: ["fell", "fallen"],
  stand: ["stood"],
  understand: ["understood"],
  speak: ["spoke", "spoken"],
  throw: ["threw", "thrown"],
  wear: ["wore", "worn"],
  write: ["wrote", "written"],
  drive: ["drove", "driven"],
  ride: ["rode", "ridden"],
  rise: ["rose", "risen"],
  eat: ["ate", "eaten"],
  fly: ["flew", "flown"],
  know: ["knew", "known"],
  grow: ["grew", "grown"],
  blow: ["blew", "blown"],
  draw: ["drew", "drawn"],
  show: ["showed", "shown"],
  begin: ["began", "begun"],
  drink: ["drank", "drunk"],
  ring: ["rang", "rung"],
  sing: ["sang", "sung"],
  swim: ["swam", "swum"],
  hang: ["hung"],
  stick: ["stuck"],
  strike: ["struck"],
  shoot: ["shot"],
  feed: ["fed"],
  lead: ["led"],
  light: ["lit"],
  bite: ["bit", "bitten"],
  hide: ["hid", "hidden"],
  shake: ["shook", "shaken"],
  steal: ["stole", "stolen"],
  choose: ["chose", "chosen"],
  forget: ["forgot", "forgotten"],
  freeze: ["froze", "frozen"],
  wake: ["woke", "woken"],
  child: ["children"],
  person: ["people"],
  man: ["men"],
  woman: ["women"],
  foot: ["feet"],
  tooth: ["teeth"],
  mouse: ["mice"],
  good: ["better", "best"],
  well: ["better", "best"],
  bad: ["worse", "worst"],
  far: ["farther", "farthest", "further", "furthest"],
  many: ["more", "most"],
  much: ["more", "most"],
  little: ["less", "least"],
};

/**
 * Words that stand in for one another in a headword: `a` for `an`, and each
 * set of personal pronouns, so "it's up to you" may be blanked as "It's up
 * to me".
 */
const INTERCHANGEABLE = [
  ["a", "an"],
  ["i", "you", "he", "she", "it", "we", "they"],
  ["me", "you", "him", "her", "it", "us", "them"],
  ["my", "your", "his", "her", "its", "our", "their"],
  [
    "myself",
    "yourself",
    "himself",
    "herself",
    "itself",
    "ourselves",
    "yourselves",
    "themselves",
  ],
];

/**
 * Placeholders a headword may name (`make up one's mind`, `get on someone's
 * nerves`). The example fills them in, so a blank may skip one, or blank the
 * word that fills it.
 *
 * @type {Readonly<Record<string, readonly string[] | undefined>>}
 */
const PLACEHOLDERS = {
  "one's": INTERCHANGEABLE[3],
  "someone's": undefined,
  "somebody's": undefined,
  oneself: INTERCHANGEABLE[4],
  someone: undefined,
  somebody: undefined,
  something: undefined,
  sb: undefined,
  sth: undefined,
};

/**
 * @param {string} text - English text.
 * @returns {string[]} Its words, lower case, with surrounding punctuation and
 *   braces dropped; an inner apostrophe or hyphen is kept (`it's`, `well-known`).
 */
export function wordsOf(text) {
  return text
    .toLowerCase()
    .replaceAll(/[‘’`]/gu, "'")
    .split(/\s+/u)
    .map((token) => token.replaceAll(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((token) => token !== "");
}

/**
 * The regular inflections of a word: -s, -es, -ed, -ing, -er, -est with the
 * usual spelling changes (a dropped e, y to i, a doubled final consonant,
 * f to ves).
 *
 * @param {string} word - A lower-case word.
 * @returns {Set<string>} Its regular forms, itself included.
 */
function regularForms(word) {
  const forms = new Set([word]);
  for (const suffix of ["s", "es", "ed", "d", "ing", "er", "r", "est", "st"]) {
    forms.add(word + suffix);
  }
  if (word.endsWith("e")) {
    const stem = word.slice(0, -1);
    forms.add(`${stem}ing`);
    if (word.endsWith("ie")) forms.add(`${word.slice(0, -2)}ying`);
  }
  if (/[^aeiou]y$/u.test(word)) {
    const stem = word.slice(0, -1);
    for (const suffix of ["ies", "ied", "ier", "iest"]) forms.add(stem + suffix);
  }
  const last = word.at(-1) ?? "";
  if (/[^aeiou][aeiou][bdgklmnprt]$/u.test(word)) {
    for (const suffix of ["ed", "ing", "er", "est"]) forms.add(word + last + suffix);
  }
  if (word.endsWith("fe")) forms.add(`${word.slice(0, -2)}ves`);
  else if (word.endsWith("f")) forms.add(`${word.slice(0, -1)}ves`);
  return forms;
}

/**
 * @param {string} word - A blanked word, lower case.
 * @param {string} head - The headword's word it stands for, lower case.
 * @returns {boolean} True when `word` is a form of `head`.
 */
export function isFormOf(word, head) {
  if (regularForms(head).has(word)) return true;
  const irregular = IRREGULAR[head] ?? [];
  if (irregular.some((form) => form === word || regularForms(form).has(word))) {
    return true;
  }
  return INTERCHANGEABLE.some((group) => group.includes(head) && group.includes(word));
}

/**
 * Whether the blanked words, in order, are the headword's words in some form.
 * Every headword word must be blanked, except a placeholder, which the
 * example may fill in outside the blanks.
 *
 * @param {readonly string[]} blanked - The blanked words, in order.
 * @param {readonly string[]} head - The headword's words.
 * @returns {boolean} True when they align.
 */
export function blanksMatch(blanked, head) {
  /**
   * @param {number} at - Position in `head`.
   * @param {number} from - Position in `blanked`.
   * @returns {boolean} Whether the rest aligns.
   */
  const align = (at, from) => {
    if (at === head.length) return from === blanked.length;
    const word = head[at] ?? "";
    const next = blanked[from];
    if (Object.hasOwn(PLACEHOLDERS, word)) {
      if (align(at + 1, from)) return true;
      const fillers = PLACEHOLDERS[word];
      return (
        next !== undefined &&
        (fillers === undefined || fillers.includes(next)) &&
        align(at + 1, from + 1)
      );
    }
    return next !== undefined && isFormOf(next, word) && align(at + 1, from + 1);
  };
  return align(0, 0);
}

/**
 * @param {string} text - An example.
 * @returns {{ blanks: string[], wellFormed: boolean }} What each `{{…}}` holds,
 *   in order, and whether every brace belongs to a non-empty blank.
 */
export function blanksOf(text) {
  const blanks = [...text.matchAll(BLANK)].map((match) => match[1] ?? "");
  const rest = text.replaceAll(BLANK, "");
  return {
    blanks,
    wellFormed: !/[{}]/u.test(rest) && blanks.every((blank) => blank.trim() !== ""),
  };
}

/**
 * @param {string} text - An example with its blanks.
 * @returns {string} The same text with each `{{…}}` replaced by what it holds.
 */
export function fillBlanks(text) {
  return text.replaceAll(BLANK, "$1");
}

/**
 * The normalized form two headwords are compared in: lower case, contractions
 * expanded, punctuation dropped.
 *
 * @param {string} headword - A headword.
 * @returns {string} Its normalized form.
 */
export function normalizeHeadword(headword) {
  return normalizeEn(headword);
}

/**
 * @typedef {import("./rules.mjs").Finding} Finding
 * @typedef {import("./store.mjs").Lists} Lists
 */

/**
 * @param {unknown} value - Candidate.
 * @returns {value is string} True for a non-empty string.
 */
function isText(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Check the shape of every field.
 *
 * @param {Record<string, unknown>} raw - A vocabulary card.
 * @param {string} id - How findings name it.
 * @param {{ requireStored: boolean }} options - Whether `id`, `createdAt`
 *   and `stamps` must be present (false for a card not yet admitted).
 * @returns {Finding[]} Shape findings.
 */
function shapeFindings(raw, id, options) {
  /** @type {Finding[]} */
  const findings = [];
  const add = (/** @type {string} */ message) => {
    findings.push({ id, rule: "SHAPE", message });
  };
  const known = new Set([
    "id",
    ...VOCAB_CORE_FIELDS,
    "meanings",
    "createdAt",
    "stamps",
  ]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) add(`unknown key "${key}"`);
  }
  for (const key of ["category", "headword", "definition", "example", "example2"]) {
    if (!isText(raw[key])) add(`"${key}" must be a non-empty string`);
  }
  if (typeof raw["level"] !== "number" || !Number.isInteger(raw["level"])) {
    add('"level" must be an integer');
  }
  /** @type {readonly string[]} */
  const languages = VOCAB_LANGUAGES;
  const meanings = raw["meanings"];
  if (typeof meanings !== "object" || meanings === null || Array.isArray(meanings)) {
    add('"meanings" must be an object keyed by language');
  } else {
    if (Object.keys(meanings).length === 0) add('"meanings" holds no language');
    for (const [lang, meaning] of Object.entries(meanings)) {
      if (!languages.includes(lang)) {
        add(`meanings.${lang}: "${lang}" is not one of ${languages.join(", ")}`);
      } else if (!isText(meaning)) {
        add(`meanings.${lang} must be a non-empty string`);
      }
    }
  }
  if (!options.requireStored) return findings;
  if (typeof raw["id"] !== "string" || !VOCAB_ID_PATTERN.test(raw["id"])) {
    findings.push({
      id,
      rule: "ID_FORMAT",
      message: `"id" must match ${VOCAB_ID_PATTERN.source}`,
    });
  }
  if (typeof raw["createdAt"] !== "string" || !DATE.test(raw["createdAt"])) {
    add('"createdAt" must be a YYYY-MM-DD date');
  }
  const stamps = raw["stamps"];
  if (typeof stamps !== "object" || stamps === null || Array.isArray(stamps)) {
    add('"stamps" must be an object');
    return findings;
  }
  const names = ["core", ...languages.map(meaningStamp)];
  for (const name of Object.keys(stamps)) {
    const stamp = readStamp(stamps, name);
    if (!names.includes(name)) {
      add(`stamp "${name}" names neither the core nor a meaning`);
    } else if (stamp === undefined || !HASH.test(stamp.hash) || !DATE.test(stamp.at)) {
      add(`stamp "${name}" must be { hash: "sha256:<hex>", perspectivesVersion, at }`);
    }
  }
  return findings;
}

/**
 * Check one English text: no Japanese, no ellipsis, one line unless it is a
 * dialogue, and each line within its word cap.
 *
 * @param {string} label - The field, for messages.
 * @param {string} text - Its value.
 * @param {{ cap: number, dialogue: "never" | "always" | "allowed", sentence: boolean }} rules
 *   - The word cap a line; whether the text is a two-line `A:`/`B:` dialogue;
 *   whether each line must end as a sentence and hold only one.
 * @param {(rule: string, message: string) => void} add - Records a finding.
 * @returns {void}
 */
function checkEnglish(label, text, rules, add) {
  if (hasJapanese(text))
    add("JAPANESE_IN_EN", `"${label}" contains Japanese characters`);
  if (hasEllipsis(text)) add("ELLIPSIS", `"${label}" contains "..." or "…"`);
  const lines = text.split("\n");
  const isDialogue =
    lines.length === SPEAKERS.length &&
    lines.every((line, index) => line.startsWith(`${SPEAKERS[index] ?? ""}: `));
  if (rules.dialogue === "always" && !isDialogue) {
    add("DIALOGUE", `"${label}" must be two lines, "A: …" then "B: …"`);
    return;
  }
  if (rules.dialogue === "never" && lines.length > 1) {
    add("ONE_LINE", `"${label}" must be one line`);
    return;
  }
  if (rules.dialogue === "allowed" && lines.length > 1 && !isDialogue) {
    add("DIALOGUE", `"${label}" must be one line, or two lines "A: …" then "B: …"`);
    return;
  }
  for (const [index, line] of lines.entries()) {
    const body = isDialogue ? line.slice(3) : line;
    const where = isDialogue ? `"${label}" line ${String(index + 1)}` : `"${label}"`;
    const words = countWords(body);
    if (words > rules.cap) {
      add(
        "WORD_COUNT",
        `${where} has ${String(words)} words; at most ${String(rules.cap)}`,
      );
    }
    if (!rules.sentence) continue;
    if (!endsAsSentence(body))
      add("END_PUNCTUATION", `${where} must end with ".", "?" or "!"`);
    if (!isDialogue && hasSecondSentenceEn(fillBlanks(body))) {
      add("ONE_SENTENCE", `${where} holds more than one sentence`);
    }
  }
}

/**
 * Lint one vocabulary card on its own: everything except uniqueness,
 * tombstones and which file it sits in.
 *
 * @param {Record<string, unknown>} raw - A vocabulary card.
 * @param {string} id - How findings name it.
 * @param {Lists} lists - The validated tag lists, for the levels.
 * @param {{ requireStored: boolean }} options - See {@link shapeFindings}.
 * @returns {Finding[]} Every finding.
 */
export function lintVocabCard(raw, id, lists, options) {
  const findings = shapeFindings(raw, id, options);
  const add = (/** @type {string} */ rule, /** @type {string} */ message) => {
    findings.push({ id, rule, message });
  };
  const { category, level, headword, definition, example, example2, meanings } = raw;
  /** @type {readonly string[]} */
  const categories = VOCAB_CATEGORIES;
  if (typeof category === "string" && !categories.includes(category)) {
    add("CATEGORY", `category "${category}" is not one of ${categories.join(", ")}`);
  }
  if (typeof level === "number" && !lists.levels.has(level)) {
    add("LEVEL", `level ${String(level)} is not in levels.json`);
  }

  if (isText(headword)) {
    const words = countWords(headword);
    const { min, max } = VOCAB_LIMITS.headword;
    if (words < min || words > max) {
      add(
        "WORD_COUNT",
        `"headword" has ${String(words)} words; ${String(min)}–${String(max)} allowed`,
      );
    }
    if (/[\r\n{}]/u.test(headword))
      add("HEADWORD", '"headword" must be one line with no "{{…}}"');
    if (hasJapanese(headword))
      add("JAPANESE_IN_EN", '"headword" contains Japanese characters');
  }

  if (isText(definition)) {
    checkEnglish(
      "definition",
      definition,
      { cap: VOCAB_LIMITS.definitionWords, dialogue: "never", sentence: false },
      add,
    );
    if (hasSecondSentenceEn(definition))
      add("ONE_SENTENCE", '"definition" holds more than one sentence');
    if (/[{}]/u.test(definition)) add("BLANK", '"definition" must hold no "{{…}}"');
  }

  if (isText(example)) {
    const dialogue = category === DIALOGUE_CATEGORY ? "always" : "never";
    checkEnglish(
      "example",
      example,
      { cap: VOCAB_LIMITS.exampleWords, dialogue, sentence: true },
      add,
    );
    const { blanks, wellFormed } = blanksOf(example);
    if (blanks.length === 0 || !wellFormed) {
      add(
        "BLANK",
        '"example" needs at least one "{{…}}", and every brace in a non-empty one',
      );
    } else if (isText(headword)) {
      const blanked = blanks.flatMap(wordsOf);
      if (!blanksMatch(blanked, wordsOf(headword))) {
        add(
          "BLANK",
          `the blanked words "${blanked.join(" ")}" are not a form of "${headword}"`,
        );
      }
    }
  }

  if (isText(example2)) {
    const dialogue = category === DIALOGUE_CATEGORY ? "allowed" : "never";
    checkEnglish(
      "example2",
      example2,
      { cap: VOCAB_LIMITS.example2Words, dialogue, sentence: true },
      add,
    );
    if (/[{}]/u.test(example2)) add("BLANK", '"example2" must hold no "{{…}}"');
  }

  /** @type {Readonly<Record<string, number>>} */
  const caps = VOCAB_LIMITS.meaningChars;
  for (const [lang, meaning] of Object.entries(
    typeof meanings === "object" && meanings !== null ? meanings : {},
  )) {
    if (!isText(meaning)) continue;
    const cap = caps[lang];
    const length = countJaChars(meaning);
    if (cap !== undefined && length > cap) {
      add(
        "MEANING_LENGTH",
        `meanings.${lang} has ${String(length)} characters; at most ${String(cap)}`,
      );
    }
    if (/[\r\n]/u.test(meaning)) add("ONE_LINE", `meanings.${lang} must be one line`);
  }
  return findings;
}

/**
 * @param {import("./store.mjs").CardEntry} entry - A stored vocabulary card.
 * @returns {string} How findings name it: its id, or `vocab/<file>#<index>`.
 */
export function vocabLabel(entry) {
  const id = readKey(entry.raw, "id");
  return typeof id === "string" && id !== ""
    ? id
    : `vocab/${entry.file}#${String(entry.index)}`;
}

/**
 * Lint the stored vocabulary cards: each card on its own, plus unique ids,
 * tombstoned ids, file placement and file order. Duplicate headwords are
 * `cards:dupes --kind vocab`'s report, as near-duplicates are the drill's.
 *
 * @param {import("./store.mjs").Store} store - The loaded content root.
 * @param {ReadonlySet<string> | undefined} only - Restrict to these ids.
 * @returns {Finding[]} Every finding.
 */
export function lintVocabStore(store, only) {
  /** @type {Finding[]} */
  const findings = [];
  const tombstoned = new Set(
    [...store.vocabTombstones, ...store.tombstones].map((tombstone) => tombstone.id),
  );
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const entry of store.vocab) {
    const id = sortKey(entry.raw);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const entry of store.vocab) {
    const id = vocabLabel(entry);
    if (only !== undefined && !only.has(id)) continue;
    findings.push(
      ...lintVocabCard(entry.raw, id, store.lists, { requireStored: true }),
    );
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
    const { category } = entry.raw;
    if (typeof category === "string" && vocabFile(category) !== entry.file) {
      findings.push({
        id,
        rule: "FILE_LOCATION",
        message: `sits in vocab/${entry.file}; its category says vocab/${vocabFile(category)}`,
      });
    }
  }
  if (only !== undefined) return findings;
  for (const [file, records] of store.vocabFiles) {
    for (let index = 1; index < records.length; index += 1) {
      const previous = records[index - 1];
      const current = records[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        compareIds(sortKey(previous), sortKey(current)) > 0
      ) {
        findings.push({
          id: `vocab/${file}#${String(index)}`,
          rule: "FILE_ORDER",
          message: `vocab/${file} is not sorted by id`,
        });
        break;
      }
    }
  }
  for (const file of store.vocabStrayFiles) {
    findings.push({
      id: `vocab/${file}`,
      rule: "FILE_LOCATION",
      message: "not at vocab/<category>.json",
    });
  }
  return findings;
}

/**
 * @typedef {object} Headworded
 * @property {string} key - A card id, or a label such as `input[2]`.
 * @property {string} category
 * @property {string} headword
 * @property {string} [replacedBy] - On a tombstone: the id that replaced it.
 */

/**
 * @typedef {object} HeadwordPair
 * @property {string} a - The subject's key.
 * @property {string} b - The key with the same headword.
 * @property {"card" | "tombstone"} against - What `b` is.
 */

/**
 * Find the subjects whose normalized headword another card or a tombstone in
 * the same category already has — except the tombstone a subject replaced. A
 * pair of two subjects is reported once.
 *
 * @param {readonly Headworded[]} subjects - What is being checked.
 * @param {readonly Headworded[]} cards - Existing cards; may include subjects.
 * @param {readonly Headworded[]} tombstones - Every vocabulary tombstone.
 * @returns {HeadwordPair[]} The duplicate pairs, in subject order.
 */
export function findHeadwordDuplicates(subjects, cards, tombstones) {
  const subjectKeys = new Set(subjects.map((subject) => subject.key));
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {HeadwordPair[]} */
  const pairs = [];
  for (const subject of subjects) {
    const headword = normalizeHeadword(subject.headword);
    for (const other of cards) {
      if (
        other.key === subject.key ||
        other.category !== subject.category ||
        normalizeHeadword(other.headword) !== headword
      ) {
        continue;
      }
      const pairKey = [subject.key, other.key].sort().join(" ");
      if (subjectKeys.has(other.key) && seen.has(pairKey)) continue;
      seen.add(pairKey);
      pairs.push({ a: subject.key, b: other.key, against: "card" });
    }
    for (const other of tombstones) {
      if (
        other.replacedBy === subject.key ||
        other.category !== subject.category ||
        normalizeHeadword(other.headword) !== headword
      ) {
        continue;
      }
      pairs.push({ a: subject.key, b: other.key, against: "tombstone" });
    }
  }
  return pairs;
}
