// Text measurements the lint and the near-duplicate check share: word count,
// script detection, and the normalization that makes two sentences comparable.

/**
 * Units a `ja` sentence may write in Latin letters, compared without case
 * (`5km`, `100g`, `64GB`). Every other Latin word starting lower case is taken
 * to leak the English answer.
 */
export const JA_LATIN_UNITS = /** @type {const} */ ([
  "mm",
  "cm",
  "m",
  "km",
  "mg",
  "g",
  "kg",
  "ml",
  "dl",
  "l",
  "cc",
  "kb",
  "mb",
  "gb",
  "tb",
  "kw",
  "kwh",
  "mph",
  "ha",
]);

/**
 * Names that start lower case but are proper nouns all the same. Every other
 * name is written capitalized (Slack, Zoom) or in capitals (OK, PR, ATM, the
 * T of Tシャツ), and those need no list.
 */
export const JA_LOWERCASE_NAMES = /** @type {const} */ ([
  "iPhone",
  "iPad",
  "iPod",
  "iMac",
  "iOS",
  "iCloud",
  "iTunes",
  "macOS",
  "eBay",
]);

// Hiragana, katakana (full and half width), CJK ideographs and CJK punctuation.
const JAPANESE = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff61-\uff9f]/u;

// ASCII letters and their full-width forms, hyphen-joined runs kept whole so
// `Wi-Fi` is one word.
const LATIN_WORD =
  /[A-Za-z\uff21-\uff3a\uff41-\uff5a]+(?:-[A-Za-z\uff21-\uff3a\uff41-\uff5a]+)*/gu;

/**
 * @param {string} text - Any text.
 * @returns {boolean} True when it contains a Japanese character.
 */
export function hasJapanese(text) {
  return JAPANESE.test(text);
}

/**
 * Latin words in a `ja` sentence that a Japanese writer would not write
 * there: anything starting lower case, other than a unit or a listed name.
 * Capitalized and all-capital words pass as names, products and acronyms.
 *
 * @param {string} ja - A card's `ja`.
 * @returns {string[]} The offending words, as written.
 */
export function unexpectedLatinWords(ja) {
  /** @type {readonly string[]} */
  const units = JA_LATIN_UNITS;
  /** @type {readonly string[]} */
  const names = JA_LOWERCASE_NAMES;
  return [...ja.matchAll(LATIN_WORD)]
    .map((match) => match[0])
    .filter((word) => {
      const plain = word.normalize("NFKC");
      const first = plain.charAt(0);
      if (first !== first.toLowerCase()) return false;
      return !units.includes(plain.toLowerCase()) && !names.includes(plain);
    });
}

/**
 * Count words the way the timer and the level ranges mean them: whitespace
 * separated tokens that carry at least one letter or digit. `I'm` is one word,
 * a lone dash is none.
 *
 * @param {string} en - An English sentence.
 * @returns {number} Its word count.
 */
export function countWords(en) {
  return en.split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/**
 * @param {string} text - Any card text.
 * @returns {boolean} True when it contains `...` or `…`.
 */
export function hasEllipsis(text) {
  return text.includes("...") || text.includes("…");
}

/**
 * @param {string} en - An English sentence.
 * @returns {boolean} True when it ends with `.`, `?` or `!`, optionally
 *   followed by closing quotes or a closing parenthesis.
 */
export function endsAsSentence(en) {
  return /[.?!]["'”’)]*$/u.test(en);
}

/** @type {ReadonlyArray<readonly [RegExp, string]>} */
const CONTRACTIONS = [
  [/\bwon't\b/gu, "will not"],
  [/\bcan't\b/gu, "can not"],
  [/\bcannot\b/gu, "can not"],
  [/\bshan't\b/gu, "shall not"],
  [/\bain't\b/gu, "is not"],
  [/\blet's\b/gu, "let us"],
  [/n't\b/gu, " not"],
  [/'re\b/gu, " are"],
  [/'m\b/gu, " am"],
  [/'ll\b/gu, " will"],
  [/'ve\b/gu, " have"],
  [/'d\b/gu, " would"],
  [/'s\b/gu, " is"],
];

/**
 * Reduce an English sentence to what a learner would say: lower case,
 * contractions expanded, punctuation dropped. Two sentences that normalize
 * alike differ only in spelling-level detail.
 *
 * @param {string} en - An English sentence.
 * @returns {string} The normalized form.
 */
export function normalizeEn(en) {
  let text = en.toLowerCase().replaceAll(/[‘’`]/gu, "'");
  for (const [pattern, replacement] of CONTRACTIONS) {
    text = text.replaceAll(pattern, replacement);
  }
  return text
    .replaceAll(/[^\p{L}\p{N}\s]/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

/**
 * Reduce a Japanese sentence to its characters: width-normalized, lower case,
 * whitespace, punctuation and symbols dropped.
 *
 * @param {string} ja - A Japanese sentence.
 * @returns {string} The normalized form.
 */
export function normalizeJa(ja) {
  return ja
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[\s\p{P}\p{S}]/gu, "");
}

/**
 * @param {string} text - Normalized text.
 * @param {number} size - n-gram length, counted in code points.
 * @returns {Set<string>} Its character n-grams; the whole text when shorter.
 */
export function charNgrams(text, size) {
  const chars = Array.from(text);
  /** @type {Set<string>} */
  const grams = new Set();
  if (chars.length <= size) {
    if (chars.length > 0) grams.add(chars.join(""));
    return grams;
  }
  for (let start = 0; start + size <= chars.length; start += 1) {
    grams.add(chars.slice(start, start + size).join(""));
  }
  return grams;
}

/**
 * Dice coefficient of two n-gram sets.
 *
 * @param {ReadonlySet<string>} left - One set.
 * @param {ReadonlySet<string>} right - The other.
 * @returns {number} 0 (nothing shared) to 1 (identical); 0 when both are empty.
 */
export function dice(left, right) {
  if (left.size + right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) {
    if (right.has(gram)) shared += 1;
  }
  return (2 * shared) / (left.size + right.size);
}
