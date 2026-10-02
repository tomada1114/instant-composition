import { describe, expect, it } from "vitest";

import {
  fitsCardText,
  normalizeHeadword,
  VOCAB_TUNING,
  type CardText,
} from "@instant-composition/domain";

import { loadLists } from "../scripts/cards/store.mjs";
import {
  normalizeHeadword as lintNormalize,
  lintVocabCard,
  VOCAB_LIMITS,
} from "../scripts/cards/vocab-rules.mjs";

// The card rules a personal card the model writes has to meet, written in the
// domain again because the domain imports nothing: held here to the lint's
// own verdicts on the same cards, so the two cannot drift apart.

const CARD: CardText = {
  category: "idiom",
  headword: "catch up",
  definition: "To talk about what has happened since you last met.",
  example: "Let's {{catch}} {{up}} over coffee soon.",
  example2: "We caught up at the station.",
  meaning: "近況を話す",
};

const PHRASE: CardText = {
  category: "phrase",
  headword: "no worries",
  definition: "Said to tell someone that something is fine.",
  example: "A: Sorry I'm late.\nB: {{No}} {{worries}}.",
  example2: "A: Thanks for waiting.\nB: No worries.",
  meaning: "気にしないで",
};

const lists = loadLists("content");

/** The lint's verdict on the same text, as a card waiting to be admitted. */
function lintPasses(card: CardText): boolean {
  const { meaning, ...rest } = card;
  const findings = lintVocabCard(
    { ...rest, level: 4, meanings: { ja: meaning } },
    "v_00000000",
    lists,
    { requireStored: false },
  );
  return findings.length === 0;
}

const EXAMPLES: readonly [string, CardText, boolean][] = [
  ["a well-formed idiom", CARD, true],
  ["a well-formed set phrase", PHRASE, true],
  [
    "an irregular past in the blanks",
    { ...CARD, example: "We {{caught}} {{up}} last night." },
    true,
  ],
  [
    "a doubled consonant",
    {
      ...CARD,
      category: "phrasal-verb",
      headword: "run late",
      example: "I'm {{running}} {{late}} today.",
    },
    true,
  ],
  [
    "a placeholder filled outside the blanks",
    {
      ...CARD,
      headword: "make up one's mind",
      example: "She {{made}} {{up}} her {{mind}} at last.",
    },
    true,
  ],
  [
    "one blank holding two words",
    { ...CARD, example: "Let's {{catch up}} over coffee soon." },
    false,
  ],
  ["no blank", { ...CARD, example: "Let's catch up over coffee soon." }, false],
  [
    "a blank of another word",
    { ...CARD, example: "Let's {{meet}} {{up}} over coffee soon." },
    false,
  ],
  [
    "an unclosed blank",
    { ...CARD, example: "Let's {{catch}} {{up over coffee soon." },
    false,
  ],
  ["an empty blank", { ...CARD, example: "Let's {{catch}} {{up}} {{}} soon." }, false],
  [
    "an example of 16 words",
    { ...CARD, example: `Let's {{catch}} {{up}} ${"very ".repeat(13)}soon.` },
    false,
  ],
  [
    "an example without end punctuation",
    { ...CARD, example: "Let's {{catch}} {{up}} soon" },
    false,
  ],
  [
    "an example of two sentences",
    { ...CARD, example: "Hi there. Let's {{catch}} {{up}} soon." },
    false,
  ],
  [
    "an example of two lines for a word",
    { ...CARD, example: "A: Hi.\nB: Let's {{catch}} {{up}}." },
    false,
  ],
  [
    "a phrase whose example is one line",
    { ...PHRASE, example: "{{No}} {{worries}}." },
    false,
  ],
  ["a headword of 7 words", { ...CARD, headword: "a b c d e f g" }, false],
  ["a headword holding Japanese", { ...CARD, headword: "catch 上" }, false],
  ["a headword holding a blank", { ...CARD, headword: "{{catch}} up" }, false],
  [
    "a definition of two sentences",
    { ...CARD, definition: "To talk. To meet again." },
    false,
  ],
  [
    "a definition of 16 words",
    { ...CARD, definition: `To ${"talk ".repeat(15)}` },
    false,
  ],
  [
    "a definition holding a blank",
    { ...CARD, definition: "To {{talk}} again." },
    false,
  ],
  ["an example2 holding a blank", { ...CARD, example2: "We {{caught}} up." }, false],
  ["an example2 with an ellipsis", { ...CARD, example2: "We caught up..." }, false],
  ["a meaning of 21 characters", { ...CARD, meaning: "あ".repeat(21) }, false],
  ["a meaning of 20 characters", { ...CARD, meaning: "あ".repeat(20) }, true],
  ["a meaning of two lines", { ...CARD, meaning: "近況を\n話す" }, false],
  ["a blank headword", { ...CARD, headword: " " }, false],
];

describe("fitsCardText", () => {
  it.each(EXAMPLES)("agrees with the lint on %s: %s", (_, card, fits) => {
    expect(fitsCardText(card)).toBe(fits);
    expect(lintPasses(card)).toBe(fits);
  });

  it("takes the well-formed cards and refuses a broken blank", () => {
    expect(fitsCardText(CARD)).toBe(true);
    expect(fitsCardText(PHRASE)).toBe(true);
    expect(fitsCardText({ ...CARD, example: "Let's {{catch up}} soon." })).toBe(false);
  });

  it("holds the same limits as the lint", () => {
    const {
      headwordWords,
      definitionWords,
      exampleWords,
      example2Words,
      meaningChars,
    } = VOCAB_TUNING.card;
    expect({
      headword: headwordWords,
      definitionWords,
      exampleWords,
      example2Words,
      meaningChars: { ja: meaningChars },
    }).toStrictEqual(VOCAB_LIMITS);
  });
});

describe("normalizeHeadword", () => {
  it.each(["Catch up", "No worries!", "can't stand", "Let's go", "it’s up to you"])(
    "normalizes %s as the lint does",
    (headword) => {
      expect(normalizeHeadword(headword)).toBe(lintNormalize(headword));
    },
  );

  it("compares headwords without case, punctuation or contractions", () => {
    expect(normalizeHeadword("No worries!")).toBe(normalizeHeadword("no worries"));
    expect(normalizeHeadword("I'm swamped")).toBe("i am swamped");
  });
});
