import { countWords } from "./timer";
import { VOCAB_TUNING } from "./tuning";
import type { VocabCategory } from "./vocab";
import { blanksMatch, wordsOf } from "./vocab-blanks";

/** What a vocabulary card says, front and back: the catalog's, a candidate's, a personal card's. */
export interface CardText {
  readonly category: VocabCategory;
  /** The answer, in its base form. */
  readonly headword: string;
  readonly definition: string;
  /**
   * One sentence, or for a `phrase` two lines `A: …` / `B: …`, each blanked
   * word marked `{{…}}`.
   */
  readonly example: string;
  readonly example2: string;
  /** In the learner's first language. */
  readonly meaning: string;
}

/**
 * A vocabulary card the learner's own: made from a talk's candidate the
 * catalog had no card for, the model's text unreviewed. It lives in the
 * learner's partition until they delete it.
 */
export interface PersonalCard extends CardText {
  /** `p_` and twelve characters, so it never meets a catalog id (`v_…`). */
  readonly id: string;
  /** The language pair it was made for; it is shown only for that pair. */
  readonly target: string;
  readonly l1: string;
  /** The drill's level when it was made, which the new cards' order reads. */
  readonly level: number;
  readonly source: {
    readonly kind: "talk";
    readonly talkId: string;
    readonly turn: number;
  };
  /** Epoch milliseconds. */
  readonly createdAt: number;
}

const JAPANESE = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff61-\uff9f]/u;
const BLANK = /\{\{([^{}]*)\}\}/gu;
const ENDS_AS_SENTENCE = /[.?!]["'”’)]*$/u;
// Honorifics and initials end no sentence ("Ask Dr. Lee.", "the U.S. Army").
const SECOND_SENTENCE =
  /(?<!\b(?:Mr|Mrs|Ms|Dr|St|[A-Z]))[.?!]+["'”’)]*\s+["'“‘(]*[A-Z]/u;
const SPEAKERS = ["A: ", "B: "];

const CONTRACTIONS: readonly (readonly [RegExp, string])[] = [
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
 * The form two headwords are compared in — lower case, contractions
 * expanded, punctuation dropped — as the lint compares them for duplicates.
 */
export function normalizeHeadword(headword: string): string {
  let text = headword.toLowerCase().replaceAll(/[‘’`]/gu, "'");
  for (const [pattern, replacement] of CONTRACTIONS) {
    text = text.replaceAll(pattern, replacement);
  }
  return text
    .replaceAll(/[^\p{L}\p{N}\s]/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function fill(text: string): string {
  return text.replaceAll(BLANK, "$1");
}

/**
 * Whether English `text` holds no Japanese and no ellipsis, has the lines its
 * `dialogue` rule asks for, keeps each line within `cap` words and, when
 * `sentence`, ends each line as one sentence.
 */
function englishFits(
  text: string,
  cap: number,
  dialogue: "never" | "always" | "allowed",
  sentence: boolean,
): boolean {
  if (JAPANESE.test(text) || text.includes("...") || text.includes("…")) return false;
  const lines = text.split("\n");
  const isDialogue =
    lines.length === SPEAKERS.length &&
    lines.every((line, index) => line.startsWith(SPEAKERS[index] ?? ""));
  if (lines.length > 1 && (dialogue === "never" || !isDialogue)) return false;
  if (dialogue === "always" && !isDialogue) return false;
  return lines.every((line) => {
    const body = isDialogue ? line.slice(3) : line;
    return (
      countWords(body) <= cap &&
      (!sentence ||
        (ENDS_AS_SENTENCE.test(body) &&
          (isDialogue || !SECOND_SENTENCE.test(fill(body)))))
    );
  });
}

/** Whether the example's blanks are well formed, one word each, and hold the headword. */
function blanksFit(example: string, headword: string): boolean {
  const blanks = [...example.matchAll(BLANK)].map((match) => (match[1] ?? "").trim());
  return (
    blanks.length > 0 &&
    !/[{}]/u.test(example.replaceAll(BLANK, "")) &&
    blanks.every((blank) => blank !== "" && !/\s/u.test(blank)) &&
    blanksMatch(blanks.flatMap(wordsOf), wordsOf(headword))
  );
}

/**
 * Whether a card's text keeps every rule the lint holds a catalog card to
 * (`scripts/cards/vocab-rules.mjs`), so a card the model wrote can be stored
 * as a personal card beside reviewed ones.
 */
export function fitsCardText(card: CardText): boolean {
  const limits = VOCAB_TUNING.card;
  const { category, headword, definition, example, example2, meaning } = card;
  const filled = [headword, definition, example, example2, meaning].every(
    (text) => text.trim() !== "",
  );
  const phrase = category === "phrase";
  const words = countWords(headword);
  return (
    filled &&
    (VOCAB_TUNING.categories as readonly string[]).includes(category) &&
    words >= limits.headwordWords.min &&
    words <= limits.headwordWords.max &&
    !/[\r\n{}]/u.test(headword) &&
    !JAPANESE.test(headword) &&
    englishFits(definition, limits.definitionWords, "never", false) &&
    !SECOND_SENTENCE.test(definition) &&
    !/[{}]/u.test(definition) &&
    englishFits(example, limits.exampleWords, phrase ? "always" : "never", true) &&
    blanksFit(example, headword) &&
    englishFits(example2, limits.example2Words, phrase ? "allowed" : "never", true) &&
    !/[{}]/u.test(example2) &&
    Array.from(meaning.replaceAll(/\s/gu, "")).length <= limits.meaningChars &&
    !/[\r\n]/u.test(meaning)
  );
}
