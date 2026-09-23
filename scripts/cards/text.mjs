// Text measurements the lint and the near-duplicate check share: word count,
// script detection, and the normalization that makes two sentences comparable.

/**
 * ASCII words a `ja` sentence may contain. `content/guides/writing.md` allows
 * proper nouns and product names only; this list is where a new one is added,
 * after a reviewer agrees it is one.
 */
export const JA_ASCII_ALLOWLIST = /** @type {const} */ ([
  "PC",
  "Wi-Fi",
  "SNS",
  "PDF",
  "URL",
  "ID",
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
 * @param {string} ja - A card's `ja`.
 * @returns {string[]} Latin-script words in it that the allowlist does not name.
 */
export function unexpectedLatinWords(ja) {
  /** @type {readonly string[]} */
  const allowed = JA_ASCII_ALLOWLIST;
  return [...ja.matchAll(LATIN_WORD)]
    .map((match) => match[0])
    .filter((word) => !allowed.includes(word));
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
