import { describe, expect, it } from "vitest";

import {
  canonicalCore,
  coreHash,
  fieldHash,
  ID_PATTERN,
  isShown,
  randomId,
  readStamp,
} from "../scripts/cards/schema.mjs";
import { findNearDuplicates, isNearDuplicate } from "../scripts/cards/similarity.mjs";
import {
  charNgrams,
  countWords,
  dice,
  endsAsSentence,
  hasEllipsis,
  hasJapanese,
  normalizeEn,
  normalizeJa,
  unexpectedLatinWords,
} from "../scripts/cards/text.mjs";

// The hash and the "is this card shown" rule are what the app will reuse, so
// they are pinned against values computed outside this code: the canonical
// string written out by hand, and its SHA-256 from `shasum -a 256`.
const CORE = {
  ja: "会議を始めましょう。",
  en: "Let's start the meeting.",
  alternatives: ["Shall we get started?", "Let's get going."],
  point: "Let's で誘う",
  topic: "work",
  subtopic: "meetings",
  level: 1,
  grammar: ["imperatives"],
};
const CANONICAL =
  '{"ja":"会議を始めましょう。","en":"Let\'s start the meeting.","alternatives":["Shall we get started?","Let\'s get going."],"point":"Let\'s で誘う","topic":"work","subtopic":"meetings","level":1,"grammar":["imperatives"]}';
const CORE_HASH =
  "sha256:a8b1ff184ffbda254b1684a2992f2dfe659c41a53ea8b86cda491913b6ba902b";

describe("the core hash", () => {
  it("serializes exactly the core fields in their fixed order", () => {
    const shuffled = {
      grammar: CORE.grammar,
      level: CORE.level,
      subtopic: CORE.subtopic,
      topic: CORE.topic,
      point: CORE.point,
      alternatives: CORE.alternatives,
      en: CORE.en,
      ja: CORE.ja,
      createdAt: "2026-01-01",
    };
    expect(canonicalCore(shuffled)).toBe(CANONICAL);
  });

  it("pins a known card to a known hash", () => {
    expect(coreHash(CORE)).toBe(CORE_HASH);
  });

  it("hashes a backfilled field's JSON value", () => {
    expect(fieldHash("hello")).toBe(
      "sha256:5aa762ae383fbb727af3c7a36d4940a5b8c40a989452d2304fc958ff3f354e7a",
    );
  });
});

describe("isShown", () => {
  const stamp = (hash: string, perspectivesVersion = 1) => ({
    core: { hash, perspectivesVersion, at: "2026-09-22" },
  });

  it("shows a card whose core stamp matches its fields", () => {
    expect(isShown({ ...CORE, stamps: stamp(CORE_HASH) })).toBe(true);
  });

  it("keeps showing a card stamped under an older perspectivesVersion", () => {
    expect(isShown({ ...CORE, stamps: stamp(CORE_HASH, 0) })).toBe(true);
  });

  it("hides a card edited after its stamp", () => {
    expect(
      isShown({ ...CORE, en: "Let's begin the meeting.", stamps: stamp(CORE_HASH) }),
    ).toBe(false);
  });

  it.each([
    ["no stamps at all", {}],
    [
      "a core stamp missing its hash",
      { core: { perspectivesVersion: 1, at: "2026-09-22" } },
    ],
    [
      "a stamp for another field only",
      { note: { hash: CORE_HASH, perspectivesVersion: 1, at: "x" } },
    ],
  ])("hides a card with %s", (_label, stamps) => {
    expect(isShown({ ...CORE, stamps })).toBe(false);
  });

  it("reads a well-formed stamp back", () => {
    expect(readStamp(stamp(CORE_HASH), "core")).toEqual({
      hash: CORE_HASH,
      perspectivesVersion: 1,
      at: "2026-09-22",
    });
  });
});

describe("randomId", () => {
  it("alternates digits and letters after the c_ prefix", () => {
    expect(randomId(() => 0)).toBe("c_2a2a2a2a");
  });

  it("draws only ids the pattern accepts", () => {
    for (let draw = 0; draw < 200; draw += 1) {
      expect(randomId()).toMatch(ID_PATTERN);
    }
  });

  it.each(["c_7k2m9x4q", "c_2a3b4c5d"])("accepts %s", (id) => {
    expect(ID_PATTERN.test(id)).toBe(true);
  });

  it.each([
    "c_7k2m9x4",
    "c_k7m2x9q4",
    "c_7i2m9x4q",
    "c_0k2m9x4q",
    "d_7k2m9x4q",
    "C_7K2M9X4Q",
  ])("rejects %s", (id) => {
    expect(ID_PATTERN.test(id)).toBe(false);
  });
});

describe("countWords", () => {
  it.each([
    ["Let's start the meeting.", 4],
    ["I'm on my way — see you at 10:30.", 8],
    ["  Spaced   out  ", 2],
    ["", 0],
  ])("counts %j as %i words", (text, words) => {
    expect(countWords(text)).toBe(words);
  });
});

describe("normalizeEn", () => {
  it.each([
    ["I'm not sure.", "I am not sure!"],
    ["Don't worry.", "do not worry"],
    ["We can't make it.", "We cannot make it."],
    ["It won't take long.", "It will not take long."],
    ["They’re here.", "They are here."],
    ["You'll see.", "You will see."],
    ["I've done it.", "I have done it."],
    ["I'd like tea.", "I would like tea."],
    ["He's late.", "He is late."],
    ["You shan't.", "you shall not"],
    ["It ain't so.", "It is not so."],
    ["Let's go.", "Let us go."],
  ])("treats %j and %j alike", (left, right) => {
    expect(normalizeEn(left)).toBe(normalizeEn(right));
  });

  it("keeps a real wording difference", () => {
    expect(normalizeEn("Can we start?")).not.toBe(normalizeEn("Could we start?"));
  });
});

describe("Japanese text checks", () => {
  it.each([
    ["会議です。", true],
    ["ｶﾀｶﾅ", true],
    ["Plain English.", false],
  ])("hasJapanese(%j) is %s", (text, expected) => {
    expect(hasJapanese(text)).toBe(expected);
  });

  it.each([
    ["acronyms", "OK です。PR と API と CI、ATM で Tシャツ", []],
    ["capitalized names", "Slack と Zoom と GitHub と Wi-Fi", []],
    ["listed lower-case names", "iPhone と iPad と macOS と eBay", []],
    ["units in any case", "5km 歩いて 100g 買い、64GB と 2Mb と 500ml", []],
    ["full-width capitals", "ＯＫ です", []],
    ["lower-case English", "meeting を start する", ["meeting", "start"]],
    ["an unlisted lower-case name", "iWatch を買った", ["iWatch"]],
    ["full-width lower case", "ｍｅｅｔｉｎｇ です", ["ｍｅｅｔｉｎｇ"]],
  ])("judges %s in ja", (_label, ja, expected) => {
    expect(unexpectedLatinWords(ja)).toEqual(expected);
  });

  it("strips punctuation, spaces and width differences from Japanese", () => {
    expect(normalizeJa("明日、１０分 遅れます！")).toBe("明日10分遅れます");
  });
});

describe("sentence punctuation checks", () => {
  it.each([
    ["Done.", true],
    ["Really?", true],
    ['He said "stop!"', true],
    ["No end", false],
    ["Trailing space. ", false],
  ])("endsAsSentence(%j) is %s", (text, expected) => {
    expect(endsAsSentence(text)).toBe(expected);
  });

  it.each([
    ["Wait...", true],
    ["待って…", true],
    ["Fine.", false],
  ])("hasEllipsis(%j) is %s", (text, expected) => {
    expect(hasEllipsis(text)).toBe(expected);
  });
});

describe("n-gram similarity", () => {
  it("keeps a text shorter than the n-gram whole", () => {
    expect([...charNgrams("ab", 3)]).toEqual(["ab"]);
  });

  it("returns no n-grams for empty text", () => {
    expect(charNgrams("", 2).size).toBe(0);
  });

  it("scores identical sets 1 and empty sets 0", () => {
    expect(dice(new Set(["ab", "bc"]), new Set(["ab", "bc"]))).toBe(1);
    expect(dice(new Set(), new Set())).toBe(0);
  });

  it.each([
    [{ ja: 0.8, en: 0.7 }, true],
    [{ ja: 0.9, en: 0 }, true],
    [{ ja: 0, en: 0.9 }, true],
    [{ ja: 0.89, en: 0.69 }, false],
    [{ ja: 0.79, en: 0.89 }, false],
  ])("isNearDuplicate(%j) is %s", (scores, expected) => {
    expect(isNearDuplicate(scores)).toBe(expected);
  });

  it("compares within a subtopic: cards one level either side, tombstones at any level", () => {
    const base = { topic: "work", subtopic: "meetings", level: 4 };
    const subject = {
      ...base,
      key: "c_2a2a2a2a",
      ja: "明日の会議、10分遅れて始めてもいいですか？",
      en: "Can we start tomorrow's meeting ten minutes late?",
    };
    const near = {
      ...subject,
      key: "c_3b3b3b3b",
      level: 5,
      ja: "明日の会議、10分早く始めてもいいですか？",
    };
    const far = { ...near, key: "c_4c4c4c4c", level: 6 };
    const elsewhere = { ...near, key: "c_5d5d5d5d", subtopic: "requests" };
    const tombstone = { ...near, key: "c_6e6e6e6e", level: 9 };
    const replaced = { ...tombstone, key: "c_7f7f7f7f", replacedBy: subject.key };
    const otherCell = { ...tombstone, key: "c_8g8g8g8g", subtopic: "requests" };
    const pairs = findNearDuplicates(
      [subject],
      [subject, near, far, elsewhere],
      [tombstone, replaced, otherCell],
    );
    expect(pairs.map((pair) => [pair.b, pair.against])).toEqual([
      ["c_3b3b3b3b", "card"],
      ["c_6e6e6e6e", "tombstone"],
    ]);
  });

  it("reports a pair of two subjects once", () => {
    const card = {
      key: "c_2a2a2a2a",
      ja: "資料を送ってもらえますか？",
      en: "Could you send me the materials?",
      topic: "work",
      subtopic: "requests",
      level: 3,
    };
    const twin = { ...card, key: "c_3b3b3b3b" };
    expect(findNearDuplicates([card, twin], [card, twin], [])).toHaveLength(1);
  });

  const pair = (ja: [string, string], en: [string, string]) =>
    findNearDuplicates(
      [
        {
          key: "a",
          ja: ja[0],
          en: en[0],
          topic: "work",
          subtopic: "meetings",
          level: 3,
        },
      ],
      [
        {
          key: "b",
          ja: ja[1],
          en: en[1],
          topic: "work",
          subtopic: "meetings",
          level: 3,
        },
      ],
      [],
    );

  it.each([
    [
      ["駅はどこですか？", "トイレはどこですか？"],
      ["Where is the station?", "Where is the restroom?"],
    ],
    [
      ["これ、手伝ってもらえますか？", "これ、確認してもらえますか？"],
      ["Could you help me with this?", "Could you check this?"],
    ],
    [
      ["資料を共有してもらえますか？", "画面を共有してもらえますか？"],
      ["Could you share the documents?", "Could you share your screen?"],
    ],
    [
      ["会議は何時に始まりますか？", "会議は何時に終わりますか？"],
      ["What time does the meeting start?", "What time does the meeting end?"],
    ],
  ] as [[string, string], [string, string]][])(
    "does not flag short sentences that only share a frame: %j",
    (ja, en) => {
      expect(pair(ja, en)).toEqual([]);
    },
  );

  it.each([
    [
      ["私は会議に遅れました。", "彼は会議に遅れました。"],
      ["I was late for the meeting.", "He was late for the meeting."],
    ],
    [
      ["今日の会議は中止です。", "明日の会議は中止です。"],
      ["Today's meeting is canceled.", "Tomorrow's meeting is canceled."],
    ],
  ] as [[string, string], [string, string]][])(
    "still flags a true near-duplicate: %j",
    (ja, en) => {
      expect(pair(ja, en)).toHaveLength(1);
    },
  );
});
