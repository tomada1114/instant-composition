// Near-duplicate scoring for `cards:dupes` and `cards:add`.
import { charNgrams, dice, normalizeEn, normalizeJa } from "./text.mjs";

/**
 * Every tunable of the near-duplicate check, in one place. `ja` is compared on
 * character bigrams (Japanese has no word boundaries to split on), `en` on
 * character trigrams of the normalized sentence. A pair is a candidate when
 * both sides reach their threshold, or either side reaches `either`: short
 * sentences sharing a frame (「〜はどこですか？」, "What time does … start?")
 * score high on one side alone without being the same question.
 */
export const DUPES = /** @type {const} */ ({
  ja: { ngram: 2, threshold: 0.8 },
  en: { ngram: 3, threshold: 0.7 },
  either: 0.9,
  // Cards are compared with cards at most this many levels apart.
  levelSpan: 1,
});

/**
 * @typedef {object} Comparable
 * @property {string} key - A card id, or a label such as `input[2]`.
 * @property {string} ja
 * @property {string} en
 * @property {string} topic
 * @property {string} subtopic
 * @property {number} level
 * @property {string} [replacedBy] - On a tombstone: the id that replaced it.
 */

/**
 * @typedef {object} Pair
 * @property {string} a - The subject's key.
 * @property {string} b - The key it resembles.
 * @property {"card" | "tombstone"} against - What `b` is.
 * @property {number} ja - Similarity of the Japanese, 0–1.
 * @property {number} en - Similarity of the English, 0–1.
 */

/**
 * @typedef {object} Prepared
 * @property {Comparable} item
 * @property {Set<string>} ja
 * @property {Set<string>} en
 */

/**
 * @param {Comparable} item - A card-like value.
 * @returns {Prepared} The value with its n-gram sets.
 */
function prepare(item) {
  return {
    item,
    ja: charNgrams(normalizeJa(item.ja), DUPES.ja.ngram),
    en: charNgrams(normalizeEn(item.en), DUPES.en.ngram),
  };
}

/**
 * @param {number} value - A score.
 * @returns {number} The score rounded to two decimals, for stable output.
 */
function round(value) {
  return Math.round(value * 100) / 100;
}

/**
 * @param {Prepared} left - One side.
 * @param {Prepared} right - The other.
 * @returns {{ ja: number, en: number }} Both similarities.
 */
function score(left, right) {
  return { ja: round(dice(left.ja, right.ja)), en: round(dice(left.en, right.en)) };
}

/**
 * @param {{ ja: number, en: number }} scores - A pair's similarities.
 * @returns {boolean} True when the pair is a near-duplicate candidate.
 */
export function isNearDuplicate(scores) {
  return (
    (scores.ja >= DUPES.ja.threshold && scores.en >= DUPES.en.threshold) ||
    scores.ja >= DUPES.either ||
    scores.en >= DUPES.either
  );
}

/**
 * Find the near-duplicate pairs for a set of subjects.
 *
 * @remarks
 * A subject is compared with every card in the same subtopic within
 * {@link DUPES}.levelSpan levels, and with every tombstone in the same
 * subtopic at any level — except the tombstone that the subject itself
 * replaced. That is exactly what a writer is shown, so a writer can avoid
 * everything this check would reject. A pair of two subjects is reported once.
 *
 * @param {readonly Comparable[]} subjects - What is being checked.
 * @param {readonly Comparable[]} cards - Existing cards; may include subjects.
 * @param {readonly Comparable[]} tombstones - Every tombstone.
 * @returns {Pair[]} Candidate pairs, highest score first.
 */
export function findNearDuplicates(subjects, cards, tombstones) {
  const preparedCards = cards.map(prepare);
  const preparedTombstones = tombstones.map(prepare);
  const subjectKeys = new Set(subjects.map((subject) => subject.key));
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Pair[]} */
  const pairs = [];

  for (const subject of subjects.map(prepare)) {
    for (const other of preparedCards) {
      const { item } = other;
      if (
        item.key === subject.item.key ||
        item.topic !== subject.item.topic ||
        item.subtopic !== subject.item.subtopic ||
        Math.abs(item.level - subject.item.level) > DUPES.levelSpan
      ) {
        continue;
      }
      const both = subjectKeys.has(item.key);
      const id = [subject.item.key, item.key].sort().join(" ");
      if (both && seen.has(id)) continue;
      seen.add(id);
      const scores = score(subject, other);
      if (isNearDuplicate(scores)) {
        pairs.push({ a: subject.item.key, b: item.key, against: "card", ...scores });
      }
    }
    for (const other of preparedTombstones) {
      if (
        other.item.replacedBy === subject.item.key ||
        other.item.topic !== subject.item.topic ||
        other.item.subtopic !== subject.item.subtopic
      ) {
        continue;
      }
      const scores = score(subject, other);
      if (isNearDuplicate(scores)) {
        pairs.push({
          a: subject.item.key,
          b: other.item.key,
          against: "tombstone",
          ...scores,
        });
      }
    }
  }
  return pairs.sort(
    (left, right) =>
      Math.max(right.ja, right.en) - Math.max(left.ja, left.en) ||
      left.a.localeCompare(right.a) ||
      left.b.localeCompare(right.b),
  );
}
