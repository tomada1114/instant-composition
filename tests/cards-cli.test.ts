import { existsSync, readdirSync, readFileSync, rmSync, utimesSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { describeCardsLockContract } from "./cards-lock-contract";
import { CardsError } from "../scripts/cards/errors.mjs";
import { coreHash, fieldHash } from "../scripts/cards/schema.mjs";
import { vocabCoreHash } from "../scripts/cards/vocab-schema.mjs";
import {
  jaCharsMax,
  jsonOut,
  makeCard,
  makeContentRoot,
  makeInput,
  makeVocabCard,
  makeVocabInput,
  removeContentRoots,
  runCards,
  GRAMMAR,
  TAXONOMY,
  writeCards,
  writeInput,
  writeUnder,
  writeVocab,
} from "./cards-fixture";

// Every `cards:*` command driven in-process through `main`, against a
// throwaway content root. The formatter is a no-op here; the lifecycle suite
// runs the real one.

describeCardsLockContract(makeContentRoot);

afterEach(() => {
  removeContentRoots();
});

const NOTE_FIELD = {
  name: "note",
  check: (value: unknown) =>
    typeof value === "string" ? undefined : "must be a string",
};

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function cardFile(root: string, file: string): Record<string, unknown>[] {
  return readJson(path.join(root, "cards", file)) as Record<string, unknown>[];
}

function tombstoneLines(root: string): Record<string, unknown>[] {
  return readFileSync(path.join(root, "tombstones.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function stamped(card: Record<string, unknown>, perspectivesVersion = 2) {
  const core = card as unknown as Parameters<typeof coreHash>[0];
  return {
    ...card,
    stamps: { core: { hash: coreHash(core), perspectivesVersion, at: "2026-09-10" } },
  };
}

function errorCode(stderr: string): string | undefined {
  return /^(ERR_CARDS_[A-Z_]+):/mu.exec(stderr)?.[1];
}

describe("the command line", () => {
  it("rejects an unknown command with ERR_CARDS_USAGE", () => {
    const run = runCards(makeContentRoot(), ["nope"]);
    expect(run.code).toBe(1);
    expect(errorCode(run.err)).toBe("ERR_CARDS_USAGE");
    expect(run.err).toMatch(/^Next: /mu);
  });

  it("rejects a missing command", () => {
    expect(errorCode(runCards(makeContentRoot(), []).err)).toBe("ERR_CARDS_USAGE");
  });

  it.each([
    ["an unknown flag", ["lint", "--nope"]],
    ["a value on a boolean flag", ["lint", "--json=yes"]],
    ["a flag missing its value", ["show", "--cell"]],
    ["a flag followed by another flag", ["show", "--cell", "--brief"]],
    ["a non-integer --limit", ["queue", "--limit", "many"]],
    ["a zero --limit", ["queue", "--limit=0"]],
    ["an extra positional", ["lint", "extra"]],
    ["a range on a command without one", ["lint", "topic=work"]],
    ["a malformed subtopic=", ["queue", "subtopic=work"]],
    ["a malformed level=", ["queue", "level=0-3"]],
    ["an unknown topic=", ["queue", "topic=space"]],
    ["an unknown subtopic=", ["queue", "subtopic=work/space"]],
    ["an empty --root", ["lint", "--root="]],
  ])("rejects %s", (_label, argv) => {
    const run = runCards(makeContentRoot(), argv);
    expect(run.code).toBe(1);
    expect(errorCode(run.err)).toBe("ERR_CARDS_USAGE");
  });

  it("takes --root from the arguments", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    const run = runCards(makeContentRoot(), ["show", "--brief", "--root", root]);
    expect(run.out).toBe("会議を始めましょう。 ⟶ Let's start the meeting.");
  });

  it("takes --root=<dir> too", () => {
    const root = makeContentRoot();
    const run = runCards(makeContentRoot(), ["show", "--brief", `--root=${root}`]);
    expect(run.out).toBe("none");
  });
});

describe("cards:lint", () => {
  it("passes a clean root", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      makeCard("c_2a2a2a2a"),
      makeCard("c_3b3b3b3b"),
    ]);
    const run = runCards(root, ["lint"]);
    expect(run.code).toBe(0);
    expect(run.out).toBe("cards:lint: 2 cards checked, 0 errors");
  });

  it.each([
    ["WORD_COUNT", { en: "Start." }],
    [
      "WORD_COUNT",
      { en: "Let's start the meeting right now because everyone is here." },
    ],
    ["JA_LENGTH", { ja: `${"会".repeat(jaCharsMax(1))}。` }],
    [
      "ALTERNATIVE_WORD_COUNT",
      {
        alternatives: [
          "Shall we go ahead and get the meeting started now?",
          "Let's get going.",
        ],
      },
    ],
    ["ALTERNATIVES_COUNT", { alternatives: ["Shall we get started?"] }],
    ["ALTERNATIVES_COUNT", { alternatives: ["A b c.", "D e f.", "G h i.", "J k l."] }],
    [
      "ALTERNATIVE_TRIVIAL",
      { alternatives: ["Let us start the meeting.", "Shall we begin?"] },
    ],
    ["ALTERNATIVE_TRIVIAL", { alternatives: ["Shall we begin?", "shall we begin"] }],
    ["JAPANESE_IN_EN", { en: "Let's start the 会議." }],
    ["END_PUNCTUATION", { en: "Let's start the meeting" }],
    ["END_PUNCTUATION", { alternatives: ["Shall we get started", "Let's get going."] }],
    ["LATIN_IN_JA", { ja: "meeting を始めましょう。" }],
    ["ONE_SENTENCE", { ja: "時間です。会議を始めましょう。" }],
    ["ONE_SENTENCE", { en: "It's time. Let's start." }],
    ["ONE_SENTENCE", { alternatives: ["It's time. Let's begin.", "Shall we begin?"] }],
    ["ELLIPSIS", { ja: "会議を…始めましょう。" }],
    ["ELLIPSIS", { en: "Let's start... the meeting." }],
    ["ELLIPSIS", { point: "Let's で..." }],
    ["POINT", { point: "あ".repeat(61) }],
    ["POINT", { point: "一行目\n二行目" }],
    ["GRAMMAR_COUNT", { grammar: [] }],
    ["GRAMMAR_COUNT", { grammar: ["imperatives", "past-simple", "present-perfect"] }],
    ["GRAMMAR_COUNT", { level: 3, grammar: ["imperatives", "imperatives"] }],
    ["GRAMMAR_UNKNOWN", { grammar: ["subjunctive"] }],
    ["GRAMMAR_LEVEL", { grammar: ["present-perfect"] }],
    ["TAXONOMY", { topic: "space" }],
    ["TAXONOMY", { subtopic: "space" }],
    ["LEVEL", { level: 11 }],
    ["SHAPE", { extra: true }],
    ["SHAPE", { ja: "" }],
    ["SHAPE", { level: 1.5 }],
    ["SHAPE", { alternatives: "Shall we?" }],
    ["SHAPE", { grammar: [1] }],
    ["SHAPE", { createdAt: "yesterday" }],
    ["SHAPE", { stamps: [] }],
    [
      "SHAPE",
      { stamps: { core: { hash: "md5:x", perspectivesVersion: 1, at: "2026-09-22" } } },
    ],
    [
      "SHAPE",
      { stamps: { note: { hash: "x", perspectivesVersion: 1, at: "2026-09-22" } } },
    ],
    ["ID_FORMAT", { id: "card-1" }],
  ])("reports %s", (rule, overrides) => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a", overrides)]);
    const run = runCards(root, ["lint"]);
    expect(run.code).toBe(1);
    expect(run.out).toContain(` ${rule} `);
    expect(errorCode(run.err)).toBe("ERR_CARDS_LINT");
  });

  it("measures ja and each alternative against the card's own level", () => {
    const root = makeContentRoot();
    const over = `${"会".repeat(jaCharsMax(1))}。`;
    writeCards(root, "work/meetings.json", [
      makeCard("c_2a2a2a2a", { ja: over }),
      makeCard("c_3b3b3b3b", { ja: over, level: 2, grammar: ["past-simple"] }),
      makeCard("c_4c4c4c4c", {
        alternatives: ["Shall we go ahead and get it started?", "Let's get going."],
      }),
      makeCard("c_5d5d5d5d", {
        alternatives: ["Shall we go ahead and get it started now?", "Let's go."],
      }),
    ]);
    const run = runCards(root, ["lint", "--json"]);
    const errors = (jsonOut(run) as { errors: { id: string; message: string }[] })
      .errors;
    expect(errors).toStrictEqual([
      {
        id: "c_2a2a2a2a",
        rule: "JA_LENGTH",
        message: `"ja" has ${String(jaCharsMax(1) + 1)} characters; level 1 allows at most ${String(jaCharsMax(1))}`,
      },
      {
        id: "c_5d5d5d5d",
        rule: "ALTERNATIVE_WORD_COUNT",
        message: "alternatives[0] has 9 words; level 1 allows at most 8",
      },
    ]);
  });

  it("does not count whitespace in ja toward its cap", () => {
    const root = makeContentRoot();
    const spaced = `${"会 ".repeat(jaCharsMax(1) - 1)}。`;
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a", { ja: spaced })]);
    expect(runCards(root, ["lint"]).code).toBe(0);
  });

  it("fails with ERR_CARDS_CONTENT on a level without a usable ja cap", () => {
    const root = makeContentRoot();
    const file = path.join(root, "levels.json");
    const levels = readJson(file) as { levels: Record<string, unknown>[] };
    const [first, second, ...rest] = levels.levels;
    writeUnder(
      root,
      "levels.json",
      JSON.stringify({
        levels: [
          Object.fromEntries(
            Object.entries(first ?? {}).filter(([key]) => key !== "jaChars"),
          ),
          { ...second, jaChars: { max: 0, target: 0 } },
          ...rest,
        ],
      }),
    );
    const run = runCards(root, ["lint"]);
    expect(errorCode(run.err)).toBe("ERR_CARDS_CONTENT");
    expect(run.err).toContain("entry #0 needs");
    expect(run.err).toContain("level 2 has jaChars.max 0");
  });

  it("fails with ERR_CARDS_CONTENT on a target outside its level's range", () => {
    const root = makeContentRoot();
    const file = path.join(root, "levels.json");
    const levels = readJson(file) as {
      levels: { words: { max: number }; jaChars: { max: number } }[];
    };
    const [first, second, ...rest] = levels.levels;
    if (first === undefined || second === undefined) throw new Error("no levels");
    writeUnder(
      root,
      "levels.json",
      JSON.stringify({
        levels: [
          { ...first, words: { ...first.words, target: first.words.max + 1 } },
          { ...second, jaChars: { ...second.jaChars, target: second.jaChars.max + 1 } },
          ...rest,
        ],
      }),
    );
    const run = runCards(root, ["lint"]);
    expect(errorCode(run.err)).toBe("ERR_CARDS_CONTENT");
    expect(run.err).toContain("level 1 has words.target");
    expect(run.err).toContain("level 2 has jaChars.target");
  });

  it("allows an allowlisted proper noun in ja", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      makeCard("c_2a2a2a2a", { ja: "PC を使って会議を始めましょう。" }),
    ]);
    expect(runCards(root, ["lint"]).code).toBe(0);
  });

  it("reports duplicate, tombstoned, misplaced and unsorted cards", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      makeCard("c_3b3b3b3b"),
      makeCard("c_2a2a2a2a"),
      makeCard("c_2a2a2a2a"),
    ]);
    writeCards(root, "work/requests.json", [makeCard("c_4c4c4c4c")]);
    writeUnder(
      root,
      "tombstones.jsonl",
      `${JSON.stringify({ id: "c_3b3b3b3b", ja: "あ", en: "A.", topic: "work", subtopic: "meetings", level: 1, reason: "x", deletedAt: "2026-09-01" })}\n`,
    );
    writeUnder(root, "cards/stray.json", "[]");
    const run = runCards(root, ["lint", "--json"]);
    const rules = (
      jsonOut(run) as { errors: { id: string; rule: string }[] }
    ).errors.map((finding) => `${finding.id} ${finding.rule}`);
    expect(rules).toEqual(
      expect.arrayContaining([
        "c_2a2a2a2a ID_DUPLICATE",
        "c_3b3b3b3b ID_TOMBSTONED",
        "c_4c4c4c4c FILE_LOCATION",
        "work/meetings.json#1 FILE_ORDER",
        "cards/stray.json FILE_LOCATION",
      ]),
    );
    expect(run.code).toBe(1);
  });

  it("names a card that is not an object by its file and index", () => {
    const root = makeContentRoot();
    writeUnder(root, "cards/work/meetings.json", "[1]");
    expect(runCards(root, ["lint"]).out).toContain("work/meetings.json#0 SHAPE");
  });

  it("lints only --ids when given", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      makeCard("c_2a2a2a2a"),
      makeCard("c_3b3b3b3b", { en: "Start." }),
    ]);
    const run = runCards(root, ["lint", "--ids", "c_2a2a2a2a"]);
    expect(run.code).toBe(0);
    expect(run.out).toBe("cards:lint: 1 cards checked, 0 errors");
  });

  it("reports an unknown --ids on its own and lints the rest", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    const run = runCards(root, ["lint", "--ids", "c_2a2a2a2a,c_9z9z9z9z"]);
    expect(run.code).toBe(0);
    expect(run.err).toBe("unknown id c_9z9z9z9z: does not exist");
    expect(run.out).toBe("cards:lint: 1 cards checked, 0 errors");
  });

  it("warns about a card over its level's targets without failing", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      makeCard("c_2a2a2a2a", {
        ja: `${"会".repeat(jaCharsMax(1) - 2)}。`,
        en: "Let's start the whole meeting right now, please.",
      }),
    ]);
    const run = runCards(root, ["lint"]);
    expect(run.code).toBe(0);
    expect(run.out.split("\n")).toEqual([
      'WARN c_2a2a2a2a OVER_TARGET "en" has 8 words; level 1 aims at 7 or fewer',
      `WARN c_2a2a2a2a OVER_TARGET "ja" has ${String(jaCharsMax(1) - 1)} characters; level 1 aims at ${String(jaCharsMax(1) - 2)} or fewer`,
      "cards:lint: 1 cards checked, 0 errors, 2 warnings",
    ]);
    const json = jsonOut(runCards(root, ["lint", "--json"])) as {
      warnings: { rule: string }[];
    };
    expect(json.warnings.map((warning) => warning.rule)).toEqual([
      "OVER_TARGET",
      "OVER_TARGET",
    ]);
  });

  it("raises a card's targets by its grammar's allowance, never past the caps", () => {
    const root = makeContentRoot();
    writeUnder(
      root,
      "grammar.json",
      JSON.stringify({
        ...GRAMMAR,
        items: GRAMMAR.items.map((item) =>
          item.id === "imperatives"
            ? { ...item, targetAllowance: { words: 2, jaChars: 1 } }
            : item,
        ),
      }),
    );
    writeCards(root, "work/meetings.json", [
      makeCard("c_2a2a2a2a", {
        ja: `${"会".repeat(jaCharsMax(1) - 2)}。`,
        en: "Let's start the whole meeting right now, please.",
      }),
      makeCard("c_3b3b3b3b", { ja: `${"会".repeat(jaCharsMax(1) - 1)}。` }),
    ]);
    const run = runCards(root, ["lint"]);
    expect(run.code).toBe(0);
    expect(run.out.split("\n")).toEqual([
      `WARN c_3b3b3b3b OVER_TARGET "ja" has ${String(jaCharsMax(1))} characters; level 1 with imperatives aims at ${String(jaCharsMax(1) - 1)} or fewer`,
      "cards:lint: 2 cards checked, 0 errors, 1 warnings",
    ]);
  });

  it("fails with ERR_CARDS_CONTENT on a targetAllowance out of range", () => {
    const root = makeContentRoot();
    writeUnder(
      root,
      "grammar.json",
      JSON.stringify({
        ...GRAMMAR,
        items: GRAMMAR.items.map((item) =>
          item.id === "imperatives"
            ? { ...item, targetAllowance: { words: 3, jaChars: 1 } }
            : item,
        ),
      }),
    );
    const run = runCards(root, ["lint"]);
    expect(errorCode(run.err)).toBe("ERR_CARDS_CONTENT");
    expect(run.err).toContain('"imperatives" has a `targetAllowance`');
  });

  it("checks grammar examples against their levels", () => {
    const root = makeContentRoot();
    writeUnder(
      root,
      "grammar.json",
      JSON.stringify({
        items: [
          { id: "tiny", ja: "短い", minLevel: 10, maxLevel: 10, example: "Too short…" },
        ],
      }),
    );
    const out = runCards(root, ["lint"]).out;
    expect(out.match(/grammar:tiny GRAMMAR_EXAMPLE/gu)).toHaveLength(2);
  });

  it.each([
    ["an unreadable taxonomy", "taxonomy.json", "{"],
    ["a taxonomy without topics", "taxonomy.json", "{}"],
    [
      "a duplicate topic id",
      "taxonomy.json",
      JSON.stringify({ topics: [TAXONOMY.topics[0], TAXONOMY.topics[0]] }),
    ],
    [
      "a duplicate subtopic id",
      "taxonomy.json",
      JSON.stringify({
        topics: [
          {
            id: "work",
            ja: "仕事",
            subtopics: [
              { id: "a", ja: "a", scene: "s" },
              { id: "a", ja: "a", scene: "s" },
            ],
          },
        ],
      }),
    ],
    [
      "a topic id that is not a slug",
      "taxonomy.json",
      JSON.stringify({ topics: [{ id: "../up", ja: "上", subtopics: [] }] }),
    ],
    [
      "a subtopic without a scene",
      "taxonomy.json",
      JSON.stringify({
        topics: [{ id: "work", ja: "仕事", subtopics: [{ id: "a", ja: "a" }] }],
      }),
    ],
    ["too few levels", "levels.json", JSON.stringify({ levels: [] })],
    [
      "levels out of order and inverted",
      "levels.json",
      JSON.stringify({
        levels: [{ level: 2, words: { min: 5, max: 3 }, summary: "x" }, { level: 1 }],
      }),
    ],
    ["an empty grammar list", "grammar.json", JSON.stringify({ items: [] })],
    [
      "grammar with inverted levels and a duplicate",
      "grammar.json",
      JSON.stringify({
        items: [
          { id: "a", ja: "a", minLevel: 5, maxLevel: 2, example: "A b c d." },
          { id: "a", ja: "a", minLevel: 1, maxLevel: 2, example: "A b c d." },
          { id: "b" },
        ],
      }),
    ],
    ["no perspectivesVersion line", "guides/review-perspectives.md", "# nothing\n"],
    [
      "no vocabulary perspectivesVersion line",
      "guides/vocab-review-perspectives.md",
      "# nothing\n",
    ],
  ])("fails on %s with ERR_CARDS_CONTENT", (_label, file, text) => {
    const root = makeContentRoot();
    writeUnder(root, file, text);
    const run = runCards(root, ["lint"]);
    expect(run.code).toBe(1);
    expect(errorCode(run.err)).toBe("ERR_CARDS_CONTENT");
  });

  it.each(["review-perspectives.md", "vocab-review-perspectives.md"])(
    "fails when the perspectives guide %s is missing",
    (guide) => {
      const root = makeContentRoot();
      rmSync(path.join(root, "guides", guide));
      expect(errorCode(runCards(root, ["lint"]).err)).toBe("ERR_CARDS_CONTENT");
      expect(errorCode(runCards(root, ["lint", "--kind", "vocab"]).err)).toBe(
        "ERR_CARDS_CONTENT",
      );
    },
  );

  it("fails on a card file that is not an array", () => {
    const root = makeContentRoot();
    writeUnder(root, "cards/work/meetings.json", "{}");
    expect(errorCode(runCards(root, ["lint"]).err)).toBe("ERR_CARDS_CARD_FILE");
  });

  it.each([
    ["not JSON", "{\n"],
    ["missing fields", '{"id":"c_2a2a2a2a"}\n'],
    [
      "a non-string replacedBy",
      `${JSON.stringify({ id: "c_2a2a2a2a", ja: "あ", en: "A.", topic: "work", subtopic: "meetings", level: 1, reason: "x", deletedAt: "2026-09-01", replacedBy: 3 })}\n`,
    ],
  ])("fails on a tombstone line that is %s", (_label, text) => {
    const root = makeContentRoot();
    writeUnder(root, "tombstones.jsonl", text);
    expect(errorCode(runCards(root, ["lint"]).err)).toBe("ERR_CARDS_TOMBSTONES");
  });

  it("treats a missing tombstone log as empty", () => {
    const root = makeContentRoot();
    rmSync(path.join(root, "tombstones.jsonl"));
    expect(runCards(root, ["lint"]).code).toBe(0);
  });
});

describe("cards:gaps", () => {
  it("fills the thinnest cells first, at most three each, spread across topics", () => {
    const run = runCards(makeContentRoot(), ["gaps", "11", "--json"]);
    const { plan, shortfall } = jsonOut(run) as {
      plan: { topic: string; count: number; targetGrammar: string[] }[];
      shortfall: number;
    };
    expect(plan.map((cell) => cell.count)).toEqual([3, 3, 3, 2]);
    expect(new Set(plan.slice(0, 2).map((cell) => cell.topic)).size).toBe(2);
    for (const cell of plan) {
      expect(cell.targetGrammar).toHaveLength(cell.count >= 3 ? 3 : 2);
    }
    expect(shortfall).toBe(0);
    expect(run.err).toBe("");
  });

  it("warns and reports a shortfall when the range has too few cells", () => {
    const run = runCards(makeContentRoot(), [
      "gaps",
      "10",
      "subtopic=daily/home",
      "level=4-5",
      "--json",
    ]);
    expect(jsonOut(run)).toEqual(
      expect.objectContaining({ requested: 10, planned: 6, shortfall: 4 }),
    );
    expect(run.err).toMatch(/^WARN cards:gaps planned 6 of 10 cards/u);
    expect(run.code).toBe(0);
  });

  it("aims only at grammar valid at the cell's level, least used first", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      makeCard("c_2a2a2a2a", {
        level: 3,
        grammar: ["requests-permission"],
        en: "Could you open the window?",
      }),
    ]);
    const { plan } = jsonOut(
      runCards(root, ["gaps", "2", "subtopic=work/meetings", "level=3", "--json"]),
    ) as { plan: { targetGrammar: string[] }[] };
    expect(plan[0]?.targetGrammar).toHaveLength(2);
    expect(plan[0]?.targetGrammar).not.toContain("requests-permission");
  });

  it("stays inside the range and skips cells that already have cards", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    const { plan } = jsonOut(
      runCards(root, ["gaps", "5", "topic=work", "level=1", "--json"]),
    ) as { plan: { subtopic: string; level: number; count: number }[] };
    expect(plan.map((cell) => [cell.subtopic, cell.level, cell.count])).toEqual([
      ["requests", 1, 3],
      ["meetings", 1, 2],
    ]);
  });

  it("uses --history to pick topics, levels around the estimate, unseen cards and focus", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      makeCard("c_2a2a2a2a", { level: 2, en: "Let's start the meeting now." }),
    ]);
    writeCards(root, "work/requests.json", [
      stamped(
        makeCard("c_3b3b3b3b", {
          subtopic: "requests",
          level: 2,
          en: "Let's start the meeting now.",
        }),
      ),
      {
        ...makeCard("c_4c4c4c4c", {
          subtopic: "requests",
          level: 2,
          en: "Let's start the meeting now.",
        }),
        stamps: {
          core: {
            hash: `sha256:${"0".repeat(64)}`,
            perspectivesVersion: 2,
            at: "2026-09-01",
          },
        },
      },
    ]);
    const history = writeInput(root, "history.json", {
      seenIds: ["c_2a2a2a2a"],
      topics: ["work"],
      focusSubtopics: ["work/requests"],
      estimatedLevel: 1,
    });
    const { plan } = jsonOut(
      runCards(root, ["gaps", "12", "--history", history, "--json"]),
    ) as { plan: { topic: string; subtopic: string; level: number }[] };
    expect(plan.every((cell) => cell.topic === "work" && cell.level <= 2)).toBe(true);
    // Focus doubles the deficit: the empty focus cell comes first, then the
    // focus cell with one unseen card, then the ordinary cells. The seen card
    // leaves meetings L2 as empty as meetings L1.
    expect(
      plan.slice(0, 2).map((cell) => `${cell.subtopic} L${String(cell.level)}`),
    ).toEqual(["requests L1", "requests L2"]);
    expect(plan.slice(2).map((cell) => cell.subtopic)).toEqual([
      "meetings",
      "meetings",
    ]);
  });

  it("prints a human plan", () => {
    const run = runCards(makeContentRoot(), ["gaps", "3", "topic=daily", "level=4"]);
    expect(run.out).toMatch(/^daily\/home L4 ×3 {2}grammar: /mu);
    expect(run.out).toMatch(/3 cards planned in 1 cells$/u);
  });

  it.each([["0"], ["x"]])("rejects a count of %s", (count) => {
    expect(errorCode(runCards(makeContentRoot(), ["gaps", count]).err)).toBe(
      "ERR_CARDS_USAGE",
    );
  });

  it("rejects a missing count", () => {
    expect(errorCode(runCards(makeContentRoot(), ["gaps"]).err)).toBe(
      "ERR_CARDS_USAGE",
    );
  });

  it.each([
    ["a missing field", { seenIds: [] }],
    [
      "an out-of-range level",
      { seenIds: [], topics: [], focusSubtopics: [], estimatedLevel: 11 },
    ],
  ])("rejects a history with %s", (_label, value) => {
    const root = makeContentRoot();
    const history = writeInput(root, "history.json", value);
    expect(errorCode(runCards(root, ["gaps", "5", "--history", history]).err)).toBe(
      "ERR_CARDS_INPUT",
    );
  });

  it("rejects an unreadable history file", () => {
    const root = makeContentRoot();
    expect(
      errorCode(
        runCards(root, ["gaps", "5", "--history", path.join(root, "missing.json")]).err,
      ),
    ).toBe("ERR_CARDS_INPUT");
  });
});

describe("cards:dupes", () => {
  function seed(root: string): void {
    writeCards(root, "work/meetings.json", [
      makeCard("c_2a2a2a2a", {
        level: 4,
        ja: "明日の会議、10分遅れて始めてもいいですか？",
        en: "Can we start tomorrow's meeting ten minutes late?",
        grammar: ["requests-permission"],
      }),
      makeCard("c_3b3b3b3b", {
        level: 5,
        ja: "明日の会議、10分早く始めてもいいですか？",
        en: "Can we start tomorrow's meeting ten minutes early?",
        grammar: ["requests-permission"],
      }),
      makeCard("c_4c4c4c4c", { level: 1 }),
    ]);
  }

  it("lists near-duplicate pairs with both scores", () => {
    const root = makeContentRoot();
    seed(root);
    const run = runCards(root, ["dupes"]);
    expect(run.out).toMatch(
      /^ja 0\.\d\d \/ en 0\.\d\d {2}c_2a2a2a2a ~ c_3b3b3b3b \(card\)$/mu,
    );
    expect(run.out).toMatch(/1 near-duplicate candidates$/u);
  });

  it("limits the subjects to --ids and prints JSON", () => {
    const root = makeContentRoot();
    seed(root);
    const pairs = jsonOut(runCards(root, ["dupes", "--ids", "c_4c4c4c4c", "--json"]));
    expect(pairs).toEqual([]);
  });

  it("checks cards from --input against the store", () => {
    const root = makeContentRoot();
    seed(root);
    const input = writeInput(root, "dupes.json", [makeInput({ level: 2 })]);
    const pairs = jsonOut(runCards(root, ["dupes", "--input", input, "--json"])) as {
      a: { key: string };
      b: { key: string; ja: string };
    }[];
    expect(pairs.map((pair) => [pair.a.key, pair.b.key])).toEqual([
      ["input[0]", "c_4c4c4c4c"],
    ]);
  });

  it.each([
    ["not an array", {}],
    ["an element missing fields", [{ ja: "あ" }]],
    ["an element that is not an object", [3]],
  ])("rejects --input that is %s", (_label, value) => {
    const root = makeContentRoot();
    const input = writeInput(root, "dupes.json", value);
    expect(errorCode(runCards(root, ["dupes", "--input", input]).err)).toBe(
      "ERR_CARDS_INPUT",
    );
  });
});

describe("cards:new-id", () => {
  it("prints n ids unused by cards and tombstones", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    writeUnder(
      root,
      "tombstones.jsonl",
      `${JSON.stringify({ id: "c_3a3a3a3a", ja: "あ", en: "A.", topic: "work", subtopic: "meetings", level: 1, reason: "x", deletedAt: "2026-09-01" })}\n`,
    );
    // Digits step 0, 0, 1, 1, …: the first two draws are the taken ids.
    const digits = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2];
    let call = 0;
    const random = (max: number) => (max === 8 ? (digits[call++] ?? 3) : 0);
    const run = runCards(root, ["new-id", "2"], { random });
    expect(run.out.split("\n")).toEqual(["c_4a4a4a4a", "c_5a5a5a5a"]);
  });

  it("prints one id by default", () => {
    expect(runCards(makeContentRoot(), ["new-id"]).out).toMatch(
      /^c_(?:[2-9][a-z]){4}$/u,
    );
  });

  it.each([["0"], ["1001"], ["two"]])("rejects n = %s", (n) => {
    expect(errorCode(runCards(makeContentRoot(), ["new-id", n]).err)).toBe(
      "ERR_CARDS_USAGE",
    );
  });

  it("gives up with ERR_CARDS_ID_SPACE when every draw is taken", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    expect(errorCode(runCards(root, ["new-id"], { random: () => 0 }).err)).toBe(
      "ERR_CARDS_ID_SPACE",
    );
  });
});

describe("cards:add", () => {
  it("assigns ids, dates and empty stamps, and writes sorted files", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      makeCard("c_9z9z9z9z", {
        level: 9,
        ja: "別の文です。",
        en: "This is a completely different sentence for level nine.",
        grammar: ["present-perfect"],
      }),
    ]);
    const input = writeInput(root, "add.json", [
      makeInput(),
      makeInput({
        subtopic: "requests",
        ja: "窓を開けてもらえますか？",
        en: "Could you open the window?",
        level: 2,
        grammar: ["requests-permission"],
        alternatives: ["Can you open the window?", "Would you open the window?"],
      }),
    ]);
    const run = runCards(root, ["add", input, "--json"]);
    expect(run.code).toBe(0);
    const result = jsonOut(run) as { admitted: { id: string }[]; dropped: unknown[] };
    expect(result.admitted).toHaveLength(2);
    expect(result.dropped).toEqual([]);
    const meetings = cardFile(root, "work/meetings.json");
    expect(meetings.map((card) => card["id"])).toEqual(
      [...meetings.map((card) => String(card["id"]))].sort(),
    );
    const added = meetings.find((card) => card["id"] === result.admitted[0]?.id);
    expect(Object.keys(added ?? {})).toEqual([
      "id",
      "ja",
      "en",
      "alternatives",
      "point",
      "topic",
      "subtopic",
      "level",
      "grammar",
      "createdAt",
      "stamps",
    ]);
    expect(added).toEqual(
      expect.objectContaining({ createdAt: "2026-09-22", stamps: {} }),
    );
    expect(existsSync(path.join(root, "cards", "work", "requests.json"))).toBe(true);
  });

  it("drops what fails lint, repeats an existing card or tombstone, or repeats itself", () => {
    const root = makeContentRoot();
    writeCards(root, "daily/home.json", [
      makeCard("c_2a2a2a2a", {
        topic: "daily",
        subtopic: "home",
        ja: "洗濯物を取り込んでくれる？",
        en: "Can you bring in the laundry?",
        level: 2,
        grammar: ["requests-permission"],
      }),
    ]);
    writeUnder(
      root,
      "tombstones.jsonl",
      `${JSON.stringify({ id: "c_3b3b3b3b", ja: "ゴミを出してくれる？", en: "Can you take out the trash?", topic: "daily", subtopic: "home", level: 7, reason: "x", deletedAt: "2026-09-01" })}\n`,
    );
    const input = writeInput(root, "add.json", [
      makeInput({ en: "Start." }),
      makeInput({
        topic: "daily",
        subtopic: "home",
        ja: "洗濯物を取り込んでくれる？",
        en: "Could you bring in the laundry?",
        level: 2,
        grammar: ["requests-permission"],
      }),
      makeInput({
        topic: "daily",
        subtopic: "home",
        ja: "ゴミを出してくれる？",
        en: "Can you take out the trash?",
        level: 2,
        grammar: ["requests-permission"],
      }),
      makeInput(),
      makeInput(),
      makeInput({ id: "c_4c4c4c4c" }),
      "not a card",
    ]);
    const run = runCards(root, ["add", input]);
    expect(run.code).toBe(0);
    expect(run.out).toMatch(/^dropped input\[0\] {2}WORD_COUNT /mu);
    expect(run.out).toMatch(
      /^dropped input\[1\] {2}NEAR_DUPLICATE .* with c_2a2a2a2a \(card\)/mu,
    );
    expect(run.out).toMatch(
      /^dropped input\[2\] {2}NEAR_DUPLICATE .* with c_3b3b3b3b \(tombstone\)/mu,
    );
    expect(run.out).toMatch(/^dropped input\[4\] {2}NEAR_DUPLICATE .* with c_/mu);
    expect(run.out).toMatch(/^dropped input\[5\] {2}INPUT must not carry id/mu);
    expect(run.out).toMatch(/^dropped input\[6\] {2}INPUT not a card object/mu);
    expect(run.out).toMatch(/cards:add: 1 admitted, 6 dropped$/u);
  });

  it("admits a card over its level's target with a warning", () => {
    const root = makeContentRoot();
    const input = writeInput(root, "add.json", [
      makeInput({ en: "Let's start the whole meeting right now, please." }),
    ]);
    const run = runCards(root, ["add", input]);
    expect(run.code).toBe(0);
    expect(run.out).toMatch(
      /^WARN c_\S+ OVER_TARGET "en" has 8 words; level 1 aims at 7 or fewer$/mu,
    );
    expect(run.out).toMatch(/cards:add: 1 admitted, 0 dropped, 1 over target$/u);
  });

  it("writes nothing under --dry-run", () => {
    const root = makeContentRoot();
    const input = writeInput(root, "add.json", [makeInput()]);
    const run = runCards(root, ["add", input, "--dry-run"]);
    expect(run.code).toBe(0);
    expect(run.out).toMatch(/cards:add: 1 admitted, 0 dropped$/u);
    expect(runCards(root, ["lint"]).out).toBe("cards:lint: 0 cards checked, 0 errors");
  });

  it("does not hold a rebuild against the card it replaces", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    const input = writeInput(root, "rebuild.json", [
      makeInput({ en: "Let's start the meeting now." }),
    ]);
    expect(runCards(root, ["add", input]).out).toMatch(/0 admitted/u);
    expect(runCards(root, ["add", input, "--replacing", "c_2a2a2a2a"]).out).toMatch(
      /1 admitted/u,
    );
  });

  it("rejects --replacing an id that exists nowhere", () => {
    const root = makeContentRoot();
    const input = writeInput(root, "add.json", []);
    expect(
      errorCode(runCards(root, ["add", input, "--replacing", "c_9z9z9z9z"]).err),
    ).toBe("ERR_CARDS_USAGE");
  });

  it.each([
    ["not an array", { cards: [] }],
    ["null", null],
  ])("fails with ERR_CARDS_INPUT when the input is %s", (_label, value) => {
    const root = makeContentRoot();
    const input = writeInput(root, "add.json", value);
    const run = runCards(root, ["add", input]);
    expect(run.code).toBe(1);
    expect(errorCode(run.err)).toBe("ERR_CARDS_INPUT");
  });

  it("fails with ERR_CARDS_USAGE without an input file", () => {
    expect(errorCode(runCards(makeContentRoot(), ["add"]).err)).toBe("ERR_CARDS_USAGE");
  });
});

describe("cards:update", () => {
  it("merges fields, leaves stamps alone, and so re-queues the card", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [stamped(makeCard("c_2a2a2a2a"))]);
    const before = cardFile(root, "work/meetings.json")[0]?.["stamps"];
    const edits = writeInput(root, "edits.json", [
      { id: "c_2a2a2a2a", en: "Let's begin the meeting." },
    ]);
    const run = runCards(root, ["update", edits]);
    expect(run.out).toMatch(/^updated c_2a2a2a2a {2}en$/mu);
    const after = cardFile(root, "work/meetings.json")[0];
    expect(after?.["en"]).toBe("Let's begin the meeting.");
    expect(after?.["stamps"]).toEqual(before);
    expect(runCards(root, ["queue"]).out).toMatch(/^c_2a2a2a2a {2}changed /mu);
  });

  it("moves a retagged card to its new file under the same id", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      makeCard("c_2a2a2a2a"),
      makeCard("c_3b3b3b3b", { ja: "別の文です。" }),
    ]);
    const edits = writeInput(root, "edits.json", [
      { id: "c_2a2a2a2a", subtopic: "requests" },
    ]);
    const run = runCards(root, ["update", edits, "--json"]);
    expect(jsonOut(run)).toEqual({
      updated: [
        { id: "c_2a2a2a2a", fields: ["subtopic"], movedFrom: "work/meetings.json" },
      ],
      rejected: [],
    });
    expect(cardFile(root, "work/requests.json").map((card) => card["id"])).toEqual([
      "c_2a2a2a2a",
    ]);
    expect(cardFile(root, "work/meetings.json").map((card) => card["id"])).toEqual([
      "c_3b3b3b3b",
    ]);
  });

  it("deletes a file its last card moved out of", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    const edits = writeInput(root, "edits.json", [
      { id: "c_2a2a2a2a", subtopic: "requests" },
    ]);
    runCards(root, ["update", edits]);
    expect(existsSync(path.join(root, "cards", "work", "meetings.json"))).toBe(false);
  });

  it("rejects entries that would fail lint or touch what it must not, leaving the card as it was", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    writeUnder(
      root,
      "tombstones.jsonl",
      `${JSON.stringify({ id: "c_3b3b3b3b", ja: "あ", en: "A.", topic: "work", subtopic: "meetings", level: 1, reason: "x", deletedAt: "2026-09-01" })}\n`,
    );
    const edits = writeInput(root, "edits.json", [
      { id: "c_2a2a2a2a", en: "Start." },
      { id: "c_2a2a2a2a", stamps: {} },
      { id: "c_2a2a2a2a", ja: null },
      { id: "c_9z9z9z9z", en: "Let's go now." },
      { id: "c_3b3b3b3b", en: "Let's go now." },
      { en: "No id." },
      [],
    ]);
    const run = runCards(root, ["update", edits]);
    expect(run.code).toBe(0);
    expect(run.out).toMatch(/^rejected c_2a2a2a2a {2}WORD_COUNT /mu);
    expect(run.out).toMatch(
      /^rejected c_2a2a2a2a {2}INPUT "stamps" is not an editable field$/mu,
    );
    expect(run.out).toMatch(/^rejected c_2a2a2a2a {2}INPUT "ja" is a core field/mu);
    expect(run.out).toMatch(
      /^rejected c_9z9z9z9z {2}UNKNOWN_ID no card has this id$/mu,
    );
    expect(run.out).toMatch(
      /^rejected c_3b3b3b3b {2}UNKNOWN_ID this id is tombstoned$/mu,
    );
    expect(run.out).toMatch(/^rejected input\[5\] {2}INPUT /mu);
    expect(run.out).toMatch(/^rejected input\[6\] {2}INPUT /mu);
    expect(cardFile(root, "work/meetings.json")).toEqual([makeCard("c_2a2a2a2a")]);
  });

  it("sets and clears a declared optional field", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    const options = { optionalFields: [NOTE_FIELD] };
    runCards(
      root,
      ["update", writeInput(root, "set.json", [{ id: "c_2a2a2a2a", note: "メモ" }])],
      options,
    );
    expect(cardFile(root, "work/meetings.json")[0]?.["note"]).toBe("メモ");
    const cleared = runCards(
      root,
      ["update", writeInput(root, "clear.json", [{ id: "c_2a2a2a2a", note: null }])],
      options,
    );
    expect(cleared.out).toMatch(/^updated c_2a2a2a2a {2}note$/mu);
    expect(cardFile(root, "work/meetings.json")[0]).not.toHaveProperty("note");
    const bad = runCards(
      root,
      ["update", writeInput(root, "bad.json", [{ id: "c_2a2a2a2a", note: 3 }])],
      options,
    );
    expect(bad.out).toMatch(
      /^rejected c_2a2a2a2a {2}FIELD "note": must be a string$/mu,
    );
  });

  it("reports an entry that changes nothing", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    const run = runCards(root, [
      "update",
      writeInput(root, "same.json", [{ id: "c_2a2a2a2a" }]),
    ]);
    expect(run.out).toMatch(/^updated c_2a2a2a2a {2}\(no change\)$/mu);
  });
});

describe("cards:tombstone", () => {
  it("removes the card, appends the tombstone, and never hands the id out again", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      makeCard("c_2a2a2a2a"),
      makeCard("c_3b3b3b3b", { ja: "別の文です。" }),
    ]);
    const run = runCards(root, [
      "tombstone",
      "--id",
      "c_2a2a2a2a",
      "--reason",
      "failed second review: stiff",
      "--replaced-by",
      "c_3b3b3b3b",
    ]);
    expect(run.code).toBe(0);
    expect(cardFile(root, "work/meetings.json").map((card) => card["id"])).toEqual([
      "c_3b3b3b3b",
    ]);
    expect(tombstoneLines(root)).toEqual([
      {
        id: "c_2a2a2a2a",
        ja: "会議を始めましょう。",
        en: "Let's start the meeting.",
        topic: "work",
        subtopic: "meetings",
        level: 1,
        reason: "failed second review: stiff",
        deletedAt: "2026-09-22",
        replacedBy: "c_3b3b3b3b",
      },
    ]);
    expect(errorCode(runCards(root, ["new-id"], { random: () => 0 }).err)).toBe(
      "ERR_CARDS_ID_SPACE",
    );
  });

  it("deletes the file of the last card in a cell", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a", { level: "one" })]);
    runCards(root, ["tombstone", "--id", "c_2a2a2a2a", "--reason", "broken"]);
    expect(existsSync(path.join(root, "cards", "work", "meetings.json"))).toBe(false);
    expect(tombstoneLines(root)[0]).toEqual(expect.objectContaining({ level: 0 }));
    expect(tombstoneLines(root)[0]).not.toHaveProperty("replacedBy");
  });

  it.each([
    ["no --id", ["tombstone", "--reason", "x"], "ERR_CARDS_USAGE"],
    ["no --reason", ["tombstone", "--id", "c_2a2a2a2a"], "ERR_CARDS_USAGE"],
    [
      "a blank --reason",
      ["tombstone", "--id", "c_2a2a2a2a", "--reason", " "],
      "ERR_CARDS_USAGE",
    ],
    [
      "a multi-line --reason",
      ["tombstone", "--id", "c_2a2a2a2a", "--reason", "a\nb"],
      "ERR_CARDS_USAGE",
    ],
    [
      "an unknown id",
      ["tombstone", "--id", "c_9z9z9z9z", "--reason", "x"],
      "ERR_CARDS_UNKNOWN_ID",
    ],
    [
      "a self replacement",
      [
        "tombstone",
        "--id",
        "c_2a2a2a2a",
        "--reason",
        "x",
        "--replaced-by",
        "c_2a2a2a2a",
      ],
      "ERR_CARDS_USAGE",
    ],
    [
      "an unknown replacement",
      [
        "tombstone",
        "--id",
        "c_2a2a2a2a",
        "--reason",
        "x",
        "--replaced-by",
        "c_9z9z9z9z",
      ],
      "ERR_CARDS_UNKNOWN_ID",
    ],
  ])("refuses %s", (_label, argv, code) => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    expect(errorCode(runCards(root, argv).err)).toBe(code);
    expect(cardFile(root, "work/meetings.json")).toHaveLength(1);
  });
});

describe("cards:stamp", () => {
  it("stamps the current hash, perspectives version and date", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    const run = runCards(root, ["stamp", "--ids", "c_2a2a2a2a"]);
    expect(run.out).toBe("stamped c_2a2a2a2a core");
    expect(cardFile(root, "work/meetings.json")[0]?.["stamps"]).toEqual({
      core: {
        hash: "sha256:a8b1ff184ffbda254b1684a2992f2dfe659c41a53ea8b86cda491913b6ba902b",
        perspectivesVersion: 2,
        at: "2026-09-22",
      },
    });
  });

  it("refuses a card that fails lint but stamps the rest", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      makeCard("c_2a2a2a2a"),
      makeCard("c_3b3b3b3b", { en: "Start." }),
      makeCard("c_4c4c4c4c", { level: "one" }),
    ]);
    const run = runCards(root, [
      "stamp",
      "--ids",
      "c_2a2a2a2a,c_3b3b3b3b",
      "c_4c4c4c4c",
    ]);
    expect(run.code).toBe(1);
    expect(errorCode(run.err)).toBe("ERR_CARDS_STAMP_REFUSED");
    expect(run.err).toMatch(/c_3b3b3b3b \(WORD_COUNT\)/u);
    const stamps = cardFile(root, "work/meetings.json").map((card) =>
      Object.keys(card["stamps"] as object),
    );
    expect(stamps).toEqual([["core"], [], []]);
  });

  it("stamps a declared field separately from the core", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      makeCard("c_2a2a2a2a", { note: "hello" }),
      makeCard("c_3b3b3b3b", { ja: "別の文です。" }),
    ]);
    const run = runCards(
      root,
      ["stamp", "--ids", "c_2a2a2a2a", "c_3b3b3b3b", "--field", "note"],
      {
        optionalFields: [NOTE_FIELD],
      },
    );
    expect(run.err).toMatch(/c_3b3b3b3b \(no "note" to stamp\)/u);
    expect(cardFile(root, "work/meetings.json")[0]?.["stamps"]).toEqual({
      note: {
        hash: "sha256:5aa762ae383fbb727af3c7a36d4940a5b8c40a989452d2304fc958ff3f354e7a",
        perspectivesVersion: 2,
        at: "2026-09-22",
      },
    });
  });

  it.each([
    ["no ids", ["stamp"], "ERR_CARDS_USAGE"],
    [
      "an undeclared field",
      ["stamp", "--ids", "c_2a2a2a2a", "--field", "note"],
      "ERR_CARDS_UNKNOWN_FIELD",
    ],
    ["an unknown id", ["stamp", "--ids", "c_9z9z9z9z"], "ERR_CARDS_STAMP_REFUSED"],
  ])("refuses %s", (_label, argv, code) => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    expect(errorCode(runCards(root, argv).err)).toBe(code);
  });
});

describe("cards:queue", () => {
  function seed(root: string): void {
    writeCards(root, "work/meetings.json", [
      stamped(makeCard("c_2a2a2a2a", { ja: "現在の文です。" })),
      stamped(makeCard("c_3b3b3b3b", { ja: "古い観点の文です。" }), 1),
      {
        ...stamped(makeCard("c_4c4c4c4c", { ja: "変わった文です。" })),
        en: "Let's begin the meeting.",
      },
      makeCard("c_5d5d5d5d", { ja: "未確認の文です。" }),
      makeCard("c_6e6e6e6e", { ja: "壊れた文です。", en: "Start." }),
    ]);
  }

  it("orders lint errors, unstamped, changed, then outdated, and leaves current cards out", () => {
    const root = makeContentRoot();
    seed(root);
    const run = runCards(root, ["queue"]);
    expect(
      run.out.split("\n").map((line) => line.split("  ").slice(0, 2).join(" ")),
    ).toEqual([
      "c_6e6e6e6e lint-error",
      "c_5d5d5d5d unstamped",
      "c_4c4c4c4c changed",
      "c_3b3b3b3b outdated",
      "4 queued, 4 listed",
    ]);
  });

  it("counts, limits and prints JSON with each card's lint errors", () => {
    const root = makeContentRoot();
    seed(root);
    expect(runCards(root, ["queue", "--count"]).out).toBe("4");
    const listed = jsonOut(runCards(root, ["queue", "--limit", "1", "--json"])) as {
      reason: string;
      errors: { rule: string }[];
      card: { id: string };
    }[];
    expect(listed.map((entry) => [entry.reason, entry.card.id])).toEqual([
      ["lint-error", "c_6e6e6e6e"],
    ]);
    expect(listed[0]?.errors.map((error) => error.rule)).toEqual(["WORD_COUNT"]);
  });

  it("lists every --ids card, current ones last", () => {
    const root = makeContentRoot();
    seed(root);
    const run = runCards(root, ["queue", "--ids", "c_2a2a2a2a,c_5d5d5d5d"]);
    expect(run.out).toMatch(/^c_5d5d5d5d {2}unstamped[^\n]*\nc_2a2a2a2a {2}current/mu);
  });

  it("filters by range", () => {
    const root = makeContentRoot();
    seed(root);
    expect(runCards(root, ["queue", "--count", "topic=daily"]).out).toBe("0");
  });

  it("queues a backfilled field that is unstamped or changed", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      makeCard("c_2a2a2a2a", { note: "a" }),
      makeCard("c_3b3b3b3b", {
        ja: "二つ目です。",
        note: "b",
        stamps: {
          note: {
            hash: `sha256:${"0".repeat(64)}`,
            perspectivesVersion: 2,
            at: "2026-09-01",
          },
        },
      }),
      makeCard("c_4c4c4c4c", {
        ja: "三つ目です。",
        note: "hello",
        stamps: {
          note: {
            hash: "sha256:5aa762ae383fbb727af3c7a36d4940a5b8c40a989452d2304fc958ff3f354e7a",
            perspectivesVersion: 2,
            at: "2026-09-01",
          },
        },
      }),
      makeCard("c_5d5d5d5d", { ja: "四つ目です。" }),
    ]);
    const run = runCards(root, ["queue", "--field", "note"], {
      optionalFields: [NOTE_FIELD],
    });
    expect(
      run.out.split("\n").map((line) => line.split("  ").slice(0, 2).join(" ")),
    ).toEqual([
      "c_2a2a2a2a field-unstamped",
      "c_3b3b3b3b field-changed",
      "2 queued, 2 listed",
    ]);
  });

  it("queues cards missing a field, shown cards first", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      makeCard("c_2a2a2a2a"),
      stamped(makeCard("c_3b3b3b3b", { ja: "二つ目です。" })),
      makeCard("c_4c4c4c4c", { ja: "三つ目です。", note: "x" }),
    ]);
    const run = runCards(root, ["queue", "--missing", "note"], {
      optionalFields: [NOTE_FIELD],
    });
    expect(
      run.out.split("\n").map((line) => line.split("  ").slice(0, 2).join(" ")),
    ).toEqual([
      "c_3b3b3b3b missing (shown)",
      "c_2a2a2a2a missing",
      "2 queued, 2 listed",
    ]);
  });

  it.each([
    [
      "--field with --missing",
      ["queue", "--field", "note", "--missing", "note"],
      "ERR_CARDS_USAGE",
    ],
    ["an undeclared --field", ["queue", "--field", "note"], "ERR_CARDS_UNKNOWN_FIELD"],
  ])("rejects %s", (_label, argv, code) => {
    expect(errorCode(runCards(makeContentRoot(), argv).err)).toBe(code);
  });
});

describe("cards:show", () => {
  function seed(root: string): void {
    writeCards(root, "work/meetings.json", [
      stamped(makeCard("c_2a2a2a2a", { note: "memo" })),
      makeCard("c_3b3b3b3b", {
        level: 3,
        ja: "もう会議は始まりましたか？",
        en: "Has the meeting started yet?",
        grammar: ["present-perfect"],
      }),
    ]);
    writeUnder(
      root,
      "tombstones.jsonl",
      [
        JSON.stringify({
          id: "c_4c4c4c4c",
          ja: "消した文です。",
          en: "This was deleted.",
          topic: "work",
          subtopic: "meetings",
          level: 1,
          reason: "duplicate",
          deletedAt: "2026-09-01",
          replacedBy: "c_2a2a2a2a",
        }),
        JSON.stringify({
          id: "c_5d5d5d5d",
          ja: "家の文です。",
          en: "This was at home.",
          topic: "daily",
          subtopic: "home",
          level: 1,
          reason: "stiff",
          deletedAt: "2026-09-02",
        }),
        "",
      ].join("\n"),
    );
  }

  it("prints a cell briefly", () => {
    const root = makeContentRoot();
    seed(root);
    expect(
      runCards(root, ["show", "--cell", "work/meetings", "--level", "3", "--brief"])
        .out,
    ).toBe("もう会議は始まりましたか？ ⟶ Has the meeting started yet?");
  });

  it("prints full cards with their status and declared fields", () => {
    const root = makeContentRoot();
    seed(root);
    const run = runCards(root, ["show", "--ids", "c_2a2a2a2a"], {
      optionalFields: [NOTE_FIELD],
    });
    expect(run.out.split("\n")).toEqual([
      "c_2a2a2a2a  work/meetings L1  current",
      "  ja: 会議を始めましょう。",
      "  en: Let's start the meeting.",
      "  alternatives: Shall we get started? | Let's get going.",
      "  point: Let's で誘う",
      "  grammar: imperatives",
      '  note: "memo"',
      "1 cards",
    ]);
  });

  it("prints a malformed card without failing", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      makeCard("c_2a2a2a2a", { alternatives: "x", grammar: "y" }),
    ]);
    const run = runCards(root, ["show"]);
    expect(run.out).toContain("c_2a2a2a2a  work/meetings L1  lint-error");
    expect(run.out).toContain("  alternatives: x");
  });

  it("prints cards as JSON", () => {
    const root = makeContentRoot();
    seed(root);
    const cards = jsonOut(runCards(root, ["show", "level=3", "--json"])) as {
      id: string;
    }[];
    expect(cards.map((card) => card.id)).toEqual(["c_3b3b3b3b"]);
  });

  it("prints tombstones briefly, in full and as JSON", () => {
    const root = makeContentRoot();
    seed(root);
    expect(
      runCards(root, ["show", "--tombstones", "--cell", "work/meetings", "--brief"])
        .out,
    ).toBe("消した文です。 ⟶ This was deleted.");
    expect(
      runCards(root, ["show", "--tombstones", "--cell", "work/requests", "--brief"])
        .out,
    ).toBe("none");
    expect(runCards(root, ["show", "--tombstones"]).out.split("\n")).toEqual([
      "c_4c4c4c4c  work/meetings L1  deleted 2026-09-01 → c_2a2a2a2a: duplicate",
      "  ja: 消した文です。",
      "  en: This was deleted.",
      "c_5d5d5d5d  daily/home L1  deleted 2026-09-02: stiff",
      "  ja: 家の文です。",
      "  en: This was at home.",
      "2 tombstones",
    ]);
    const tombstones = jsonOut(
      runCards(root, ["show", "--tombstones", "--ids", "c_5d5d5d5d", "--json"]),
    ) as { id: string }[];
    expect(tombstones.map((tombstone) => tombstone.id)).toEqual(["c_5d5d5d5d"]);
  });

  it.each([
    ["a --cell without a subtopic", ["show", "--cell", "work"]],
    ["an unknown --cell", ["show", "--cell", "work/space"]],
    ["a --level out of range", ["show", "--level", "11"]],
  ])("rejects %s", (_label, argv) => {
    expect(errorCode(runCards(makeContentRoot(), argv).err)).toBe("ERR_CARDS_USAGE");
  });
});

describe("cards:stats", () => {
  function seed(root: string): void {
    writeCards(root, "work/meetings.json", [
      stamped(makeCard("c_2a2a2a2a")),
      makeCard("c_3b3b3b3b", {
        level: 3,
        ja: "もう会議は始まりましたか？",
        en: "Has the meeting started yet?",
        grammar: ["present-perfect"],
      }),
      makeCard("c_4c4c4c4c", { level: "one" }),
    ]);
    writeUnder(
      root,
      "tombstones.jsonl",
      [
        JSON.stringify({
          id: "c_5d5d5d5d",
          ja: "あ",
          en: "A.",
          topic: "work",
          subtopic: "meetings",
          level: 1,
          reason: "failed second review: stiff",
          deletedAt: "2026-09-01",
        }),
        JSON.stringify({
          id: "c_6e6e6e6e",
          ja: "い",
          en: "B.",
          topic: "work",
          subtopic: "meetings",
          level: 1,
          reason: "duplicate",
          deletedAt: "2026-09-01",
        }),
        "",
      ].join("\n"),
    );
  }

  it("summarizes in a few lines with --short", () => {
    const root = makeContentRoot();
    seed(root);
    expect(runCards(root, ["stats", "--short"]).out.split("\n")).toEqual([
      "cards: 3 (shown 1; lint-error 1, unstamped 1, changed 0, outdated 0, current 1)",
      "tombstones: 2 (failed second review 1, duplicate 1)",
      "cells: 30, empty 28",
    ]);
  });

  it("breaks down by topic, level, grammar and empty cell", () => {
    const root = makeContentRoot();
    seed(root);
    const out = runCards(root, ["stats"]).out;
    expect(out).toContain("  work: 1 0 1 0 0 0 0 0 0 0");
    expect(out).toContain("  imperatives 1");
    expect(out).toContain("  past-simple 0");
    expect(out).toContain("  work/meetings: L2 L4 L5 L6 L7 L8 L9 L10");
  });

  it("reports an empty root", () => {
    expect(runCards(makeContentRoot(), ["stats", "--short"]).out).toContain(
      "tombstones: 0\n",
    );
  });

  it("prints JSON", () => {
    const root = makeContentRoot();
    seed(root);
    expect(jsonOut(runCards(root, ["stats", "--json"]))).toEqual(
      expect.objectContaining({
        total: 3,
        shown: 1,
        tombstones: { total: 2, byReason: { "failed second review": 1, duplicate: 1 } },
        cells: { total: 30, empty: 28 },
      }),
    );
  });
});

describe("write safety", () => {
  function lockPath(root: string): string {
    return path.join(root, ".cards.lock");
  }

  it("fails fast with ERR_CARDS_BUSY while another write holds the lock", () => {
    const root = makeContentRoot();
    writeUnder(root, ".cards.lock", "123\n");
    const run = runCards(root, ["add", writeInput(root, "add.json", [makeInput()])]);
    expect(run.code).toBe(1);
    expect(errorCode(run.err)).toBe("ERR_CARDS_BUSY");
    expect(existsSync(path.join(root, "cards"))).toBe(false);
    // The lock belongs to the other command; the refused one leaves it alone.
    expect(existsSync(lockPath(root))).toBe(true);
  });

  it("retains an old legacy lock whose ownership cannot be verified", () => {
    const root = makeContentRoot();
    writeUnder(root, ".cards.lock", "123\n");
    const old = new Date(Date.now() - 11 * 60 * 1000);
    utimesSync(lockPath(root), old, old);
    const run = runCards(root, ["add", writeInput(root, "add.json", [makeInput()])]);
    expect(run.code).toBe(1);
    expect(errorCode(run.err)).toBe("ERR_CARDS_BUSY");
    expect(readFileSync(lockPath(root), "utf8")).toBe("123\n");
  });

  it.each([
    ["add", (root: string) => ["add", writeInput(root, "add.json", [makeInput()])]],
    ["a failing add", (root: string) => ["add", writeInput(root, "add.json", {})]],
    ["update", (root: string) => ["update", writeInput(root, "u.json", [])]],
    ["tombstone", () => ["tombstone", "--id", "c_2a2a2a2a", "--reason", "x"]],
    ["stamp", () => ["stamp", "--ids", "c_2a2a2a2a"]],
  ])("releases the lock after %s", (_label, argv) => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    runCards(root, argv(root));
    expect(existsSync(lockPath(root))).toBe(false);
  });

  it("reports a content root it cannot lock", () => {
    const root = makeContentRoot();
    const run = runCards(root, [
      "stamp",
      "--ids",
      "c_2a2a2a2a",
      "--root",
      path.join(root, "missing"),
    ]);
    expect(errorCode(run.err)).toBe("ERR_CARDS_CONTENT");
  });

  it("writes nothing when the formatter is not ready", () => {
    const root = makeContentRoot();
    const run = runCards(root, ["add", writeInput(root, "add.json", [makeInput()])], {
      formatter: {
        ready: () => {
          throw new CardsError("ERR_CARDS_FORMATTER", "missing", {
            expected: "a formatter",
            actual: "none",
            next: "install it",
          });
        },
        format: () => undefined,
      },
    });
    expect(errorCode(run.err)).toBe("ERR_CARDS_FORMATTER");
    expect(existsSync(path.join(root, "cards"))).toBe(false);
  });

  it("leaves every card file as it was when formatting fails", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    const before = readFileSync(
      path.join(root, "cards", "work", "meetings.json"),
      "utf8",
    );
    const run = runCards(root, ["stamp", "--ids", "c_2a2a2a2a"], {
      formatter: {
        ready: () => undefined,
        format: () => {
          throw new CardsError("ERR_CARDS_FORMATTER", "failed", {
            expected: "exit 0",
            actual: "exit 2",
            next: "look",
          });
        },
      },
    });
    expect(errorCode(run.err)).toBe("ERR_CARDS_FORMATTER");
    expect(
      readFileSync(path.join(root, "cards", "work", "meetings.json"), "utf8"),
    ).toBe(before);
    expect(readdirSync(path.join(root, "cards", "work"))).toEqual(["meetings.json"]);
  });

  it("ignores dotfiles and files that are not JSON under cards/", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    writeUnder(root, "cards/.DS_Store", "\u0000");
    writeUnder(root, "cards/work/.meetings.99.tmp.json", "{");
    writeUnder(root, "cards/work/notes.txt", "notes");
    const run = runCards(root, ["lint"]);
    expect(run.code).toBe(0);
    expect(run.out).toBe("cards:lint: 1 cards checked, 0 errors");
  });
});

describe("cards:tombstone reruns", () => {
  const argv = ["tombstone", "--id", "c_2a2a2a2a", "--reason", "duplicate"];

  it("succeeds without a second line when the card is already gone", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      makeCard("c_2a2a2a2a"),
      makeCard("c_3b3b3b3b"),
    ]);
    expect(runCards(root, argv).code).toBe(0);
    const rerun = runCards(root, argv);
    expect(rerun.code).toBe(0);
    expect(rerun.out).toBe("already tombstoned c_2a2a2a2a");
    expect(tombstoneLines(root)).toHaveLength(1);
  });

  it("finishes a run that recorded the tombstone but did not remove the card", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      makeCard("c_2a2a2a2a"),
      makeCard("c_3b3b3b3b"),
    ]);
    writeUnder(
      root,
      "tombstones.jsonl",
      `${JSON.stringify({ id: "c_2a2a2a2a", ja: "会議を始めましょう。", en: "Let's start the meeting.", topic: "work", subtopic: "meetings", level: 1, reason: "duplicate", deletedAt: "2026-09-22" })}\n`,
    );
    expect(runCards(root, argv).code).toBe(0);
    expect(cardFile(root, "work/meetings.json").map((card) => card["id"])).toEqual([
      "c_3b3b3b3b",
    ]);
    expect(tombstoneLines(root)).toHaveLength(1);
  });
});

describe("unknown ids in a batch", () => {
  function seed(root: string): void {
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    writeUnder(
      root,
      "tombstones.jsonl",
      `${JSON.stringify({ id: "c_3b3b3b3b", ja: "あ", en: "A.", topic: "work", subtopic: "meetings", level: 1, reason: "x", deletedAt: "2026-09-01" })}\n`,
    );
  }

  it("shows the known cards and reports the rest", () => {
    const root = makeContentRoot();
    seed(root);
    const run = runCards(root, ["show", "--ids", "c_2a2a2a2a,c_3b3b3b3b", "--brief"]);
    expect(run.code).toBe(0);
    expect(run.out).toBe("会議を始めましょう。 ⟶ Let's start the meeting.");
    expect(run.err).toBe("unknown id c_3b3b3b3b: tombstoned");
  });

  it("queues the known cards and reports the rest", () => {
    const root = makeContentRoot();
    seed(root);
    const run = runCards(root, ["queue", "--ids", "c_9z9z9z9z,c_2a2a2a2a", "--count"]);
    expect(run.out).toBe("1");
    expect(run.err).toBe("unknown id c_9z9z9z9z: does not exist");
  });

  it("checks the known cards for duplicates and reports the rest", () => {
    const root = makeContentRoot();
    seed(root);
    const run = runCards(root, ["dupes", "--ids", "c_3b3b3b3b"]);
    expect(run.code).toBe(0);
    expect(run.err).toBe("unknown id c_3b3b3b3b: tombstoned");
  });

  it("stamps the known cards and refuses the rest by id", () => {
    const root = makeContentRoot();
    seed(root);
    const run = runCards(root, ["stamp", "--ids", "c_2a2a2a2a,c_3b3b3b3b"]);
    expect(run.code).toBe(1);
    expect(run.out).toBe("stamped c_2a2a2a2a core");
    expect(errorCode(run.err)).toBe("ERR_CARDS_STAMP_REFUSED");
    expect(run.err).toMatch(/c_3b3b3b3b \(tombstoned\)/u);
  });
});

describe("the writer's view of a cell", () => {
  it("shows the cards one level either side with a --level range", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      makeCard("c_2a2a2a2a", { level: 2, ja: "二の文です。" }),
      makeCard("c_3b3b3b3b", { level: 3, ja: "三の文です。" }),
      makeCard("c_4c4c4c4c", { level: 4, ja: "四の文です。" }),
      makeCard("c_5d5d5d5d", { level: 5, ja: "五の文です。" }),
    ]);
    const run = runCards(root, [
      "show",
      "--cell",
      "work/meetings",
      "--level",
      "2-4",
      "--brief",
    ]);
    expect(run.out.split("\n").map((line) => line.split(" ")[0])).toEqual([
      "二の文です。",
      "三の文です。",
      "四の文です。",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The same commands under `--kind vocab`, against content/vocab/.

function vocabFileOf(root: string, file: string): Record<string, unknown>[] {
  return readJson(path.join(root, "vocab", file)) as Record<string, unknown>[];
}

interface VocabStamp {
  hash: string;
  perspectivesVersion: number;
  at: string;
}

function vocabStamped(
  card: Record<string, unknown>,
  perspectivesVersion = 2,
): Record<string, unknown> & { stamps: Record<string, VocabStamp> } {
  const core = card as unknown as Parameters<typeof vocabCoreHash>[0];
  const meanings = card["meanings"] as Record<string, string>;
  const stamp = (hash: string): VocabStamp => ({
    hash,
    perspectivesVersion,
    at: "2026-09-10",
  });
  return {
    ...card,
    stamps: {
      core: stamp(vocabCoreHash(core)),
      ...Object.fromEntries(
        Object.entries(meanings).map(([lang, text]) => [
          `meanings.${lang}`,
          stamp(fieldHash(text)),
        ]),
      ),
    },
  };
}

function vocab(root: string, argv: string[]) {
  const [command = "", ...rest] = argv;
  return runCards(root, [command, "--kind", "vocab", ...rest]);
}

const PHRASE = {
  category: "phrase",
  level: 3,
  headword: "no worries",
  definition: "said to tell someone that something is not a problem",
  example: "A: Sorry, I forgot to call you back.\nB: {{No}} {{worries}}.",
  example2: "A: Thanks for waiting.\nB: No worries, I just got here.",
  meanings: { ja: "気にしないで" },
};

describe("the command line with --kind", () => {
  it.each([
    ["an unknown kind", ["lint", "--kind", "grammar"]],
    ["a kind without a value", ["lint", "--kind="]],
    ["a topic= on a vocab command", ["queue", "--kind", "vocab", "topic=work"]],
    ["a category= on a drill command", ["queue", "category=word"]],
    ["an unknown category=", ["queue", "--kind", "vocab", "category=verb"]],
    ["a drill-only flag", ["show", "--kind", "vocab", "--cell", "work/meetings"]],
  ])("rejects %s", (_label, argv) => {
    const run = runCards(makeContentRoot(), argv);
    expect(run.code).toBe(1);
    expect(errorCode(run.err)).toBe("ERR_CARDS_USAGE");
  });

  it("takes --kind=vocab, and --kind composition as the drill", () => {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [makeVocabCard("v_2a2a2a2a")]);
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    expect(runCards(root, ["show", "--kind=vocab", "--brief"]).out).toBe(
      "give up (phrasal-verb)",
    );
    expect(runCards(root, ["show", "--kind", "composition", "--brief"]).out).toBe(
      "会議を始めましょう。 ⟶ Let's start the meeting.",
    );
  });

  it("leaves the drill's lint exactly as it was when vocab/ holds errors", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    writeVocab(root, "phrase.json", [
      makeVocabCard("v_2a2a2a2a", { ...PHRASE, example: "{{No}} {{worries}}." }),
    ]);
    const run = runCards(root, ["lint"]);
    expect(run.code).toBe(0);
    expect(run.out).toBe("cards:lint: 1 cards checked, 0 errors");
  });
});

describe("cards:lint --kind vocab", () => {
  it("passes a clean root", () => {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [makeVocabCard("v_2a2a2a2a")]);
    writeVocab(root, "phrase.json", [makeVocabCard("v_3a3a3a3a", PHRASE)]);
    const run = vocab(root, ["lint"]);
    expect(run.code).toBe(0);
    expect(run.out).toBe("cards:lint: 2 vocab cards checked, 0 errors");
  });

  it("fails on a phrase whose example is one line, naming the card and the rule", () => {
    const root = makeContentRoot();
    writeVocab(root, "phrase.json", [
      makeVocabCard("v_2a2a2a2a", {
        ...PHRASE,
        example: "{{No}} {{worries}}, it happens.",
      }),
    ]);
    const run = vocab(root, ["lint"]);
    expect(run.code).toBe(1);
    expect(errorCode(run.err)).toBe("ERR_CARDS_LINT");
    expect(run.out).toContain("v_2a2a2a2a DIALOGUE ");
  });

  it.each([
    ["CATEGORY", { category: "verb" }],
    ["LEVEL", { level: 11 }],
    ["WORD_COUNT", { headword: "give up on the idea of it all" }],
    ["HEADWORD", { headword: "give {{up}}" }],
    ["JAPANESE_IN_EN", { headword: "give up あきらめ" }],
    [
      "WORD_COUNT",
      {
        definition:
          "to stop trying to do something you wanted to do because it is far too hard",
      },
    ],
    ["ONE_SENTENCE", { definition: "To stop trying. It is too hard." }],
    ["ONE_LINE", { definition: "to stop trying\nbecause it is hard" }],
    ["BLANK", { definition: "to {{stop}} trying" }],
    ["BLANK", { example: "She was so tired that she gave up halfway." }],
    ["BLANK", { example: "She was so tired that she {{gave up halfway." }],
    ["BLANK", { example: "She was so tired that she {{took}} {{up}} halfway." }],
    ["BLANK", { example: "She was so tired that she {{gave up}} halfway." }],
    ["END_PUNCTUATION", { example: "She was so tired that she {{gave}} {{up}}" }],
    ["ONE_SENTENCE", { example: "She was tired. She {{gave}} {{up}}." }],
    ["ONE_LINE", { example: "She was tired.\nShe {{gave}} {{up}}." }],
    ["DIALOGUE", { ...PHRASE, example: "B: Sorry.\nA: {{No}} {{worries}}." }],
    [
      "WORD_COUNT",
      {
        example:
          "She was so very tired after the long day that she finally {{gave}} {{up}} on it.",
      },
    ],
    ["ELLIPSIS", { example: "She was so tired that she {{gave}} {{up}}..." }],
    ["BLANK", { example2: "Don't {{give}} up." }],
    [
      "WORD_COUNT",
      {
        example2:
          "Don't give up now, because you are almost there and everyone is waiting for you today.",
      },
    ],
    [
      "MEANING_LENGTH",
      { meanings: { ja: "あきらめてやめること、途中で投げ出してしまうこと" } },
    ],
    ["ONE_LINE", { meanings: { ja: "あきらめる\nやめる" } }],
    ["SHAPE", { meanings: { zh: "放弃" } }],
    ["SHAPE", { meanings: {} }],
    ["SHAPE", { meanings: "あきらめる" }],
    ["SHAPE", { meanings: { ja: "" } }],
    ["SHAPE", { note: "extra" }],
    ["SHAPE", { headword: "" }],
    ["SHAPE", { level: "4" }],
    ["SHAPE", { createdAt: "yesterday" }],
    ["SHAPE", { stamps: [] }],
    [
      "SHAPE",
      {
        stamps: {
          note: { hash: "sha256:0", perspectivesVersion: 1, at: "2026-09-10" },
        },
      },
    ],
    [
      "SHAPE",
      { stamps: { core: { hash: "x", perspectivesVersion: 1, at: "2026-09-10" } } },
    ],
  ])("reports %s for %j", (rule, overrides) => {
    const root = makeContentRoot();
    const card = makeVocabCard("v_2a2a2a2a", overrides);
    const category = typeof card["category"] === "string" ? card["category"] : "x";
    writeVocab(root, `${category}.json`, [card]);
    const run = vocab(root, ["lint", "--json"]);
    expect(run.code).toBe(1);
    const { errors } = jsonOut(run) as { errors: { id: string; rule: string }[] };
    expect(errors.map((finding) => finding.rule)).toContain(rule);
  });

  it("checks a phrase's example2 as one line or a two-line dialogue", () => {
    const root = makeContentRoot();
    writeVocab(root, "phrase.json", [
      makeVocabCard("v_2a2a2a2a", {
        ...PHRASE,
        example2: "No worries, I just got here.",
      }),
      makeVocabCard("v_3a3a3a3a", {
        ...PHRASE,
        headword: "never mind",
        example: "A: I lost it.\nB: {{Never}} {{mind}}.",
        example2: "B: Thanks.\nA: Never mind.",
      }),
    ]);
    const run = vocab(root, ["lint"]);
    expect(run.out.split("\n").filter((line) => line.startsWith("v_"))).toEqual([
      'v_3a3a3a3a DIALOGUE "example2" must be one line, or two lines "A: …" then "B: …"',
    ]);
  });

  it("reports bad, duplicate, tombstoned, misplaced and unsorted cards, and stray files", () => {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [
      makeVocabCard("v_3a3a3a3a"),
      makeVocabCard("v_2a2a2a2a"),
      makeVocabCard("v_2a2a2a2a", {
        headword: "pick up",
        example: "{{Pick}} me {{up}}.",
      }),
      makeVocabCard("v_4a4a4a4a", { category: "idiom" }),
      makeVocabCard("c_5a5a5a5a"),
    ]);
    writeVocab(root, "nested/word.json", []);
    writeUnder(
      root,
      "tombstones.jsonl",
      `${JSON.stringify({ kind: "vocab", id: "v_3a3a3a3a", category: "phrasal-verb", level: 4, headword: "give up", reason: "x", deletedAt: "2026-09-01" })}\n`,
    );
    const run = vocab(root, ["lint"]);
    expect(run.out).toContain("v_2a2a2a2a ID_DUPLICATE ");
    expect(run.out).toContain("v_3a3a3a3a ID_TOMBSTONED ");
    expect(run.out).toContain(
      "v_4a4a4a4a FILE_LOCATION sits in vocab/phrasal-verb.json; its category says vocab/idiom.json",
    );
    expect(run.out).toContain("c_5a5a5a5a ID_FORMAT ");
    expect(run.out).toContain("vocab/phrasal-verb.json#1 FILE_ORDER ");
    expect(run.out).toContain("vocab/nested/word.json FILE_LOCATION ");
  });

  it("names a card that is not an object by its file and index", () => {
    const root = makeContentRoot();
    writeUnder(root, "vocab/word.json", "[1]\n");
    expect(vocab(root, ["lint"]).out).toContain("vocab/word.json#0 SHAPE ");
  });

  it("lints only --ids, reporting an unknown one on its own", () => {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [
      makeVocabCard("v_2a2a2a2a"),
      makeVocabCard("v_3a3a3a3a", { level: 0 }),
    ]);
    const run = vocab(root, ["lint", "--ids", "v_2a2a2a2a", "v_9z9z9z9z"]);
    expect(run.code).toBe(0);
    expect(run.err).toBe("unknown id v_9z9z9z9z: does not exist");
    expect(run.out).toBe("cards:lint: 1 vocab cards checked, 0 errors");
  });
});

describe("cards:add --kind vocab", () => {
  it("admits a card as v_…, sorted into its category's file", () => {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [
      makeVocabCard("v_9z9z9z9z", {
        headword: "pick up",
        example: "Can you {{pick}} me {{up}}?",
        example2: "I'll pick you up.",
      }),
    ]);
    const ids = ["v_2a2a2a2a"];
    const run = runCards(
      root,
      ["add", "--kind", "vocab", writeInput(root, "new.json", [makeVocabInput()])],
      { random: () => 0 },
    );
    expect(run.out).toBe(
      "admitted v_2a2a2a2a  phrasal-verb L4\ncards:add: 1 admitted, 0 dropped",
    );
    const file = vocabFileOf(root, "phrasal-verb.json");
    expect(file.map((card) => card["id"])).toEqual([...ids, "v_9z9z9z9z"]);
    expect(Object.keys(file[0] ?? {})).toEqual([
      "id",
      "category",
      "level",
      "headword",
      "definition",
      "example",
      "example2",
      "meanings",
      "createdAt",
      "stamps",
    ]);
    expect(file[0]).toMatchObject({ createdAt: "2026-09-22", stamps: {} });
  });

  it("refuses a headword its category already has, but not one in another category", () => {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [makeVocabCard("v_9z9z9z9z")]);
    const input = writeInput(root, "new.json", [
      makeVocabInput({ headword: "Give up" }),
      makeVocabInput({ category: "idiom" }),
      makeVocabInput({ category: "idiom" }),
    ]);
    const run = vocab(root, ["add", input, "--json"]);
    const result = jsonOut(run) as {
      admitted: { category: string }[];
      dropped: { index: number; reasons: { rule: string; message: string }[] }[];
    };
    expect(result.admitted.map((card) => card.category)).toEqual(["idiom"]);
    expect(result.dropped.map((drop) => [drop.index, drop.reasons[0]?.rule])).toEqual([
      [0, "DUPLICATE"],
      [2, "DUPLICATE"],
    ]);
    expect(result.dropped[0]?.reasons[0]?.message).toBe(
      "same headword in phrasal-verb as v_9z9z9z9z (card)",
    );
  });

  it("drops what fails lint, is not an object, or carries stored keys, and says why", () => {
    const root = makeContentRoot();
    const input = writeInput(root, "new.json", [
      makeVocabInput({ example: "She {{took}} {{up}} tennis." }),
      "give up",
      makeVocabInput({ id: "v_2a2a2a2a" }),
    ]);
    const run = vocab(root, ["add", input]);
    expect(run.code).toBe(0);
    expect(run.out.split("\n")).toEqual([
      'dropped input[0]  BLANK the blanked words "took up" are not a form of "give up"  give up',
      "dropped input[1]  INPUT not a card object  ",
      "dropped input[2]  INPUT must not carry id  give up",
      "cards:add: 0 admitted, 3 dropped",
    ]);
    expect(existsSync(path.join(root, "vocab"))).toBe(false);
  });

  it("writes nothing under --dry-run", () => {
    const root = makeContentRoot();
    const run = vocab(root, [
      "add",
      writeInput(root, "new.json", [makeVocabInput()]),
      "--dry-run",
    ]);
    expect(run.out).toMatch(/1 admitted/u);
    expect(existsSync(path.join(root, "vocab"))).toBe(false);
  });

  it("does not hold a rebuild against the tombstone it replaces", () => {
    const root = makeContentRoot();
    writeUnder(
      root,
      "tombstones.jsonl",
      `${JSON.stringify({ kind: "vocab", id: "v_3a3a3a3a", category: "phrasal-verb", level: 4, headword: "give up", reason: "x", deletedAt: "2026-09-01" })}\n`,
    );
    const input = writeInput(root, "new.json", [makeVocabInput()]);
    expect(vocab(root, ["add", input]).out).toContain(
      "DUPLICATE same headword in phrasal-verb as v_3a3a3a3a (tombstone)",
    );
    expect(vocab(root, ["add", input, "--replacing", "v_3a3a3a3a"]).out).toContain(
      "1 admitted",
    );
  });

  it("rejects --replacing an id that exists nowhere, and a missing input file", () => {
    const root = makeContentRoot();
    const input = writeInput(root, "new.json", [makeVocabInput()]);
    expect(
      errorCode(vocab(root, ["add", input, "--replacing", "v_9z9z9z9z"]).err),
    ).toBe("ERR_CARDS_USAGE");
    expect(errorCode(vocab(root, ["add"]).err)).toBe("ERR_CARDS_USAGE");
    expect(errorCode(vocab(root, ["add", writeInput(root, "obj.json", {})]).err)).toBe(
      "ERR_CARDS_INPUT",
    );
  });
});

describe("cards:update --kind vocab", () => {
  it("merges fields and meanings, leaves stamps alone, and so re-queues the card", () => {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [vocabStamped(makeVocabCard("v_2a2a2a2a"))]);
    expect(vocab(root, ["queue", "--count"]).out).toBe("0");
    const edits = writeInput(root, "edits.json", [
      { id: "v_2a2a2a2a", level: 3, meanings: { ja: "諦める" } },
    ]);
    expect(vocab(root, ["update", edits]).out).toBe(
      "updated v_2a2a2a2a  level, meanings\ncards:update: 1 updated, 0 rejected",
    );
    const [card] = vocabFileOf(root, "phrasal-verb.json");
    expect(card).toMatchObject({ level: 3, meanings: { ja: "諦める" } });
    expect(vocab(root, ["queue"]).out).toMatch(/^v_2a2a2a2a {2}changed /u);
  });

  it("moves a recategorized card to its new file under the same id", () => {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [makeVocabCard("v_2a2a2a2a")]);
    const edits = writeInput(root, "edits.json", [
      { id: "v_2a2a2a2a", category: "idiom" },
    ]);
    const run = vocab(root, ["update", edits, "--json"]);
    expect(jsonOut(run)).toEqual({
      updated: [
        { id: "v_2a2a2a2a", fields: ["category"], movedFrom: "phrasal-verb.json" },
      ],
      rejected: [],
    });
    expect(existsSync(path.join(root, "vocab", "phrasal-verb.json"))).toBe(false);
    expect(vocabFileOf(root, "idiom.json").map((card) => card["id"])).toEqual([
      "v_2a2a2a2a",
    ]);
  });

  it("rejects entries that would fail lint or touch what it must not", () => {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [makeVocabCard("v_2a2a2a2a")]);
    writeUnder(
      root,
      "tombstones.jsonl",
      `${JSON.stringify({ kind: "vocab", id: "v_3a3a3a3a", category: "word", level: 4, headword: "borrow", reason: "x", deletedAt: "2026-09-01" })}\n`,
    );
    const edits = writeInput(root, "edits.json", [
      { id: "v_2a2a2a2a", meanings: { ja: null } },
      { id: "v_2a2a2a2a", headword: null },
      { id: "v_2a2a2a2a", createdAt: "2026-01-01" },
      { id: "v_2a2a2a2a", meanings: "諦める" },
      { id: "v_3a3a3a3a", level: 3 },
      { id: "v_9z9z9z9z", level: 3 },
      { level: 3 },
      { id: "v_2a2a2a2a", meanings: { ja: "あきらめる", zh: null } },
    ]);
    const run = vocab(root, ["update", edits]);
    expect(run.out.split("\n")).toEqual([
      "updated v_2a2a2a2a  (no change)",
      'rejected v_2a2a2a2a  SHAPE "meanings" holds no language',
      'rejected v_2a2a2a2a  INPUT "headword" is a core field and cannot be cleared',
      'rejected v_2a2a2a2a  INPUT "createdAt" is not an editable field',
      'rejected v_2a2a2a2a  INPUT "meanings" must be an object keyed by language',
      "rejected v_3a3a3a3a  UNKNOWN_ID this id is tombstoned",
      "rejected v_9z9z9z9z  UNKNOWN_ID no vocab card has this id",
      'rejected input[6]  INPUT each entry needs a string "id"',
      "cards:update: 1 updated, 7 rejected",
    ]);
  });
});

describe("cards:tombstone --kind vocab", () => {
  it("removes the card and appends a vocab tombstone, so the id is never handed out again", () => {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [
      makeVocabCard("v_2a2a2a2a"),
      makeVocabCard("v_3a3a3a3a", {
        headword: "pick up",
        example: "{{Pick}} me {{up}}.",
      }),
    ]);
    const run = vocab(root, [
      "tombstone",
      "--id",
      "v_2a2a2a2a",
      "--reason",
      "duplicate: test",
      "--replaced-by",
      "v_3a3a3a3a",
    ]);
    expect(run.out).toBe("tombstoned v_2a2a2a2a → v_3a3a3a3a: duplicate: test");
    expect(tombstoneLines(root)).toEqual([
      {
        kind: "vocab",
        id: "v_2a2a2a2a",
        category: "phrasal-verb",
        level: 4,
        headword: "give up",
        reason: "duplicate: test",
        deletedAt: "2026-09-22",
        replacedBy: "v_3a3a3a3a",
      },
    ]);
    expect(vocabFileOf(root, "phrasal-verb.json").map((card) => card["id"])).toEqual([
      "v_3a3a3a3a",
    ]);
    expect(
      runCards(root, ["new-id", "--kind", "vocab"], { random: () => 0 }).err,
    ).toMatch(/ERR_CARDS_ID_SPACE/u);
    expect(
      vocab(root, ["tombstone", "--id", "v_2a2a2a2a", "--reason", "again"]).out,
    ).toBe("already tombstoned v_2a2a2a2a");
    // The drill's commands still read the log with a vocab line in it.
    expect(runCards(root, ["show", "--tombstones", "--brief"]).out).toBe("none");
  });

  it("deletes the file of the last card in a category", () => {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [makeVocabCard("v_2a2a2a2a")]);
    expect(vocab(root, ["tombstone", "--id", "v_2a2a2a2a", "--reason", "x"]).code).toBe(
      0,
    );
    expect(existsSync(path.join(root, "vocab", "phrasal-verb.json"))).toBe(false);
  });

  it.each([
    ["no --id", ["--reason", "x"], "ERR_CARDS_USAGE"],
    ["an empty --reason", ["--id", "v_2a2a2a2a", "--reason", " "], "ERR_CARDS_USAGE"],
    ["an unknown id", ["--id", "v_9z9z9z9z", "--reason", "x"], "ERR_CARDS_UNKNOWN_ID"],
    ["a drill id", ["--id", "c_2a2a2a2a", "--reason", "x"], "ERR_CARDS_UNKNOWN_ID"],
    [
      "--replaced-by itself",
      ["--id", "v_2a2a2a2a", "--reason", "x", "--replaced-by", "v_2a2a2a2a"],
      "ERR_CARDS_USAGE",
    ],
    [
      "--replaced-by an unknown id",
      ["--id", "v_2a2a2a2a", "--reason", "x", "--replaced-by", "v_9z9z9z9z"],
      "ERR_CARDS_UNKNOWN_ID",
    ],
  ])("refuses %s", (_label, argv, code) => {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [makeVocabCard("v_2a2a2a2a")]);
    writeCards(root, "work/meetings.json", [makeCard("c_2a2a2a2a")]);
    const run = vocab(root, ["tombstone", ...argv]);
    expect(errorCode(run.err)).toBe(code);
    expect(vocabFileOf(root, "phrasal-verb.json")).toHaveLength(1);
  });

  it("refuses a malformed vocab tombstone line", () => {
    const root = makeContentRoot();
    writeUnder(
      root,
      "tombstones.jsonl",
      `${JSON.stringify({ kind: "vocab", id: "v_2a2a2a2a" })}\n`,
    );
    expect(errorCode(vocab(root, ["lint"]).err)).toBe("ERR_CARDS_TOMBSTONES");
    writeUnder(
      root,
      "tombstones.jsonl",
      `${JSON.stringify({ kind: "grammar", id: "g_1" })}\n`,
    );
    expect(errorCode(runCards(root, ["lint"]).err)).toBe("ERR_CARDS_TOMBSTONES");
  });
});

describe("cards:stamp --kind vocab", () => {
  it("stamps the core and every meaning with the hash, perspectives version and date", () => {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [makeVocabCard("v_2a2a2a2a")]);
    const run = vocab(root, ["stamp", "--ids", "v_2a2a2a2a"]);
    expect(run.out).toBe("stamped v_2a2a2a2a core, meanings.ja");
    const [card] = vocabFileOf(root, "phrasal-verb.json");
    const expected = vocabStamped(makeVocabCard("v_2a2a2a2a")).stamps;
    expect(card?.["stamps"]).toEqual({
      core: { ...expected["core"], at: "2026-09-22" },
      "meanings.ja": { ...expected["meanings.ja"], at: "2026-09-22" },
    });
  });

  it("stamps one meaning alone with --field", () => {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [makeVocabCard("v_2a2a2a2a")]);
    expect(
      vocab(root, ["stamp", "--ids", "v_2a2a2a2a", "--field", "meanings.ja"]).out,
    ).toBe("stamped v_2a2a2a2a meanings.ja");
    expect(vocab(root, ["queue"]).out).toMatch(/^v_2a2a2a2a {2}unstamped /u);
  });

  it("refuses a card that fails lint and an unknown id, but stamps the rest", () => {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [
      makeVocabCard("v_2a2a2a2a"),
      makeVocabCard("v_3a3a3a3a", { headword: "pick up", example: "No blank here." }),
    ]);
    const run = vocab(root, ["stamp", "--ids", "v_2a2a2a2a,v_3a3a3a3a,v_9z9z9z9z"]);
    expect(run.code).toBe(1);
    expect(errorCode(run.err)).toBe("ERR_CARDS_STAMP_REFUSED");
    expect(run.err).toContain(
      "refused: v_9z9z9z9z (does not exist); v_3a3a3a3a (BLANK)",
    );
    expect(run.out).toBe("stamped v_2a2a2a2a core, meanings.ja");
  });

  it.each([
    ["no --ids", [], "ERR_CARDS_USAGE"],
    [
      "a field that is not a meaning",
      ["--ids", "v_2a2a2a2a", "--field", "headword"],
      "ERR_CARDS_UNKNOWN_FIELD",
    ],
    [
      "a language with no meanings",
      ["--ids", "v_2a2a2a2a", "--field", "meanings.zh"],
      "ERR_CARDS_UNKNOWN_FIELD",
    ],
  ])("refuses %s", (_label, argv, code) => {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [makeVocabCard("v_2a2a2a2a")]);
    expect(errorCode(vocab(root, ["stamp", ...argv]).err)).toBe(code);
  });
});

describe("cards:queue --kind vocab", () => {
  function queueRoot(): string {
    const root = makeContentRoot();
    const current = vocabStamped(makeVocabCard("v_2a2a2a2a"));
    const outdated = vocabStamped(
      makeVocabCard("v_3a3a3a3a", {
        headword: "pick up",
        example: "{{Pick}} me {{up}}.",
      }),
      1,
    );
    const changed = {
      ...vocabStamped(
        makeVocabCard("v_4a4a4a4a", {
          headword: "put off",
          example: "Don't {{put}} it {{off}}.",
        }),
      ),
      level: 5,
    };
    const meaningChanged = {
      ...vocabStamped(makeVocabCard("v_5a5a5a5a", { category: "idiom" })),
      meanings: { ja: "諦める" },
    };
    writeVocab(root, "phrasal-verb.json", [current, outdated, changed]);
    writeVocab(root, "idiom.json", [
      meaningChanged,
      makeVocabCard("v_6a6a6a6a", {
        category: "idiom",
        headword: "pick up",
        example: "{{Pick}} me {{up}}.",
      }),
      makeVocabCard("v_7a7a7a7a", { category: "idiom", level: 0 }),
    ]);
    return root;
  }

  it("orders lint errors, unstamped, changed, then outdated, and leaves current cards out", () => {
    const run = vocab(queueRoot(), ["queue"]);
    expect(run.out.split("\n")).toEqual([
      "v_7a7a7a7a  lint-error  idiom L0  give up",
      "v_6a6a6a6a  unstamped  idiom L4  pick up",
      "v_4a4a4a4a  changed  phrasal-verb L5  put off",
      "v_5a5a5a5a  changed  idiom L4  give up",
      "v_3a3a3a3a  outdated  phrasal-verb L4  pick up",
      "5 queued, 5 listed",
    ]);
  });

  it("filters by category and level, counts, limits, and prints JSON with lint errors", () => {
    const root = queueRoot();
    expect(vocab(root, ["queue", "category=idiom", "--count"]).out).toBe("3");
    expect(vocab(root, ["queue", "level=5", "--count"]).out).toBe("1");
    expect(vocab(root, ["queue", "--limit", "1"]).out).toBe(
      "v_7a7a7a7a  lint-error  idiom L0  give up\n5 queued, 1 listed",
    );
    const [first] = jsonOut(vocab(root, ["queue", "--json", "--limit", "1"])) as {
      reason: string;
      errors: { rule: string }[];
    }[];
    expect(first?.reason).toBe("lint-error");
    expect(first?.errors.map((finding) => finding.rule)).toEqual(["LEVEL"]);
  });

  it("lists every --ids card, current ones too, and reports an unknown id", () => {
    const run = vocab(queueRoot(), ["queue", "--ids", "v_2a2a2a2a,v_9z9z9z9z"]);
    expect(run.out).toBe(
      "v_2a2a2a2a  current  phrasal-verb L4  give up\n1 queued, 1 listed",
    );
    expect(run.err).toBe("unknown id v_9z9z9z9z: does not exist");
  });

  it("lists cards whose meaning is unstamped or changed under --field, current or not", () => {
    const root = makeContentRoot();
    const unstampedMeaning = vocabStamped(makeVocabCard("v_2a2a2a2a"));
    delete unstampedMeaning.stamps["meanings.ja"];
    writeVocab(root, "phrasal-verb.json", [
      unstampedMeaning,
      vocabStamped(
        makeVocabCard("v_3a3a3a3a", {
          headword: "pick up",
          example: "{{Pick}} me {{up}}.",
        }),
        1,
      ),
      makeVocabCard("v_4a4a4a4a", {
        headword: "put off",
        example: "Don't {{put}} it {{off}}.",
        meanings: {},
      }),
    ]);
    writeVocab(root, "idiom.json", [
      {
        ...vocabStamped(makeVocabCard("v_5a5a5a5a", { category: "idiom" })),
        meanings: { ja: "諦める" },
      },
    ]);
    const run = vocab(root, ["queue", "--field", "meanings.ja"]);
    expect(run.out.split("\n")).toEqual([
      "v_2a2a2a2a  field-unstamped  phrasal-verb L4  give up",
      "v_5a5a5a5a  field-changed  idiom L4  give up",
      "2 queued, 2 listed",
    ]);
  });

  it("lists cards lacking the meaning under --missing, shown ones first", () => {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [
      vocabStamped(makeVocabCard("v_2a2a2a2a")),
      makeVocabCard("v_3a3a3a3a", {
        headword: "pick up",
        example: "{{Pick}} me {{up}}.",
        meanings: {},
      }),
    ]);
    const run = vocab(root, ["queue", "--missing", "meanings.ja"]);
    expect(run.out).toBe(
      "v_3a3a3a3a  missing  phrasal-verb L4  pick up\n1 queued, 1 listed",
    );
    expect(vocab(root, ["queue", "--missing", "meanings.ja", "--count"]).out).toBe("1");
  });

  it.each([
    [
      "--field with --missing",
      ["queue", "--field", "meanings.ja", "--missing", "meanings.ja"],
      "ERR_CARDS_USAGE",
    ],
    [
      "an undeclared --field",
      ["queue", "--field", "meanings.xx"],
      "ERR_CARDS_UNKNOWN_FIELD",
    ],
    [
      "a --missing that is not a meaning",
      ["queue", "--missing", "headword"],
      "ERR_CARDS_UNKNOWN_FIELD",
    ],
  ])("fails on %s", (_label, argv, code) => {
    const run = vocab(makeContentRoot(), argv);
    expect(run.code).toBe(1);
    expect(errorCode(run.err)).toBe(code);
  });

  it("reads its own perspectivesVersion, so bumping one kind's leaves the other's queue alone", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      stamped(makeCard("c_2a2a2a2a", { ja: "現在の文です。" })),
    ]);
    writeVocab(root, "phrasal-verb.json", [vocabStamped(makeVocabCard("v_2a2a2a2a"))]);
    writeUnder(
      root,
      "guides/vocab-review-perspectives.md",
      "# Vocabulary review perspectives\n\nperspectivesVersion: 3\n",
    );
    expect(runCards(root, ["queue"]).out).toBe("0 queued, 0 listed");
    expect(vocab(root, ["queue"]).out).toMatch(/^v_2a2a2a2a {2}outdated /u);
    writeUnder(
      root,
      "guides/vocab-review-perspectives.md",
      "# Vocabulary review perspectives\n\nperspectivesVersion: 2\n",
    );
    writeUnder(
      root,
      "guides/review-perspectives.md",
      "# Review perspectives\n\nperspectivesVersion: 3\n",
    );
    expect(vocab(root, ["queue"]).out).toBe("0 queued, 0 listed");
    expect(runCards(root, ["queue"]).out).toMatch(/^c_2a2a2a2a {2}outdated /u);
  });

  it("stamps a vocabulary card with the vocabulary perspectivesVersion", () => {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [makeVocabCard("v_2a2a2a2a")]);
    writeUnder(
      root,
      "guides/vocab-review-perspectives.md",
      "# Vocabulary review perspectives\n\nperspectivesVersion: 7\n",
    );
    expect(vocab(root, ["stamp", "--ids", "v_2a2a2a2a"]).code).toBe(0);
    const [card] = vocabFileOf(root, "phrasal-verb.json");
    const stamps = card?.["stamps"] as Record<string, VocabStamp>;
    expect(stamps["core"]?.perspectivesVersion).toBe(7);
    expect(stamps["meanings.ja"]?.perspectivesVersion).toBe(7);
  });
});

describe("cards:show --kind vocab", () => {
  function showRoot(): string {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [vocabStamped(makeVocabCard("v_2a2a2a2a"))]);
    writeVocab(root, "phrase.json", [makeVocabCard("v_3a3a3a3a", PHRASE)]);
    writeVocab(root, "word.json", [{ id: "v_4a4a4a4a", category: "word" }]);
    writeUnder(
      root,
      "tombstones.jsonl",
      [
        JSON.stringify({
          id: "c_9z9z9z9z",
          ja: "削除",
          en: "Deleted.",
          topic: "work",
          subtopic: "meetings",
          level: 1,
          reason: "x",
          deletedAt: "2026-09-01",
        }),
        JSON.stringify({
          kind: "vocab",
          id: "v_8a8a8a8a",
          category: "word",
          level: 3,
          headword: "borrow",
          reason: "too easy",
          deletedAt: "2026-09-02",
          replacedBy: "v_4a4a4a4a",
        }),
        JSON.stringify({
          kind: "vocab",
          id: "v_9a9a9a9a",
          category: "idiom",
          level: 5,
          headword: "hit the road",
          reason: "dup",
          deletedAt: "2026-09-03",
        }),
        "",
      ].join("\n"),
    );
    return root;
  }

  it("prints a category briefly", () => {
    expect(
      vocab(showRoot(), ["show", "category=phrase,phrasal-verb", "--brief"]).out,
    ).toBe("give up (phrasal-verb)\nno worries (phrase)");
    expect(vocab(showRoot(), ["show", "category=idiom", "--brief"]).out).toBe("none");
  });

  it("prints full cards with their status, a dialogue on one line", () => {
    const run = vocab(showRoot(), ["show", "--level", "3-4"]);
    expect(run.out.split("\n")).toEqual([
      "v_2a2a2a2a  phrasal-verb L4  current",
      "  headword: give up",
      "  definition: to stop trying to do something because it is too hard",
      "  example: She was so tired that she {{gave}} {{up}} halfway.",
      "  example2: Don't give up; you're almost there.",
      '  meanings: {"ja":"あきらめる"}',
      "v_3a3a3a3a  phrase L3  unstamped",
      "  headword: no worries",
      "  definition: said to tell someone that something is not a problem",
      "  example: A: Sorry, I forgot to call you back. / B: {{No}} {{worries}}.",
      "  example2: A: Thanks for waiting. / B: No worries, I just got here.",
      '  meanings: {"ja":"気にしないで"}',
      "2 vocab cards",
    ]);
  });

  it("prints a malformed card without failing, and cards as JSON", () => {
    expect(vocab(showRoot(), ["show", "--ids", "v_4a4a4a4a"]).out).toContain(
      "v_4a4a4a4a  word Lundefined  lint-error",
    );
    expect(
      jsonOut(vocab(showRoot(), ["show", "--ids", "v_3a3a3a3a", "--json"])),
    ).toEqual([makeVocabCard("v_3a3a3a3a", PHRASE)]);
  });

  it("prints vocab tombstones only, briefly, in full and as JSON", () => {
    const root = showRoot();
    expect(vocab(root, ["show", "--tombstones", "--brief"]).out).toBe(
      "borrow (word)\nhit the road (idiom)",
    );
    expect(
      vocab(root, ["show", "--tombstones", "category=word"]).out.split("\n"),
    ).toEqual([
      "v_8a8a8a8a  word L3  deleted 2026-09-02 → v_4a4a4a4a: too easy",
      "  headword: borrow",
      "1 tombstones",
    ]);
    expect(
      vocab(root, ["show", "--tombstones", "--ids", "v_9a9a9a9a", "--json"]).out,
    ).toContain('"headword": "hit the road"');
    expect(
      vocab(root, ["show", "--tombstones", "--brief", "category=phrase"]).out,
    ).toBe("none");
  });

  it("rejects a malformed --level", () => {
    expect(errorCode(vocab(showRoot(), ["show", "--level", "0"]).err)).toBe(
      "ERR_CARDS_USAGE",
    );
  });
});

describe("cards:stats --kind vocab", () => {
  function statsRoot(): string {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [
      vocabStamped(makeVocabCard("v_2a2a2a2a")),
      makeVocabCard("v_3a3a3a3a", {
        headword: "pick up",
        example: "{{Pick}} me {{up}}.",
        level: 5,
      }),
    ]);
    writeVocab(root, "word.json", [
      vocabStamped(
        makeVocabCard("v_4a4a4a4a", {
          category: "word",
          headword: "borrow",
          example: "Can I {{borrow}} it?",
          level: 3,
        }),
      ),
    ]);
    writeUnder(
      root,
      "tombstones.jsonl",
      `${JSON.stringify({ kind: "vocab", id: "v_9a9a9a9a", category: "word", level: 3, headword: "lend", reason: "x", deletedAt: "2026-09-01" })}\n`,
    );
    return root;
  }

  it("summarizes in a few lines with --short", () => {
    expect(vocab(statsRoot(), ["stats", "--short"]).out.split("\n")).toEqual([
      "vocab cards: 3 (shown 2; lint-error 0, unstamped 1, changed 0, outdated 0, current 2)",
      "tombstones: 1",
      "cells: 40, empty 37",
    ]);
  });

  it("breaks down by category and level, with each category's total", () => {
    const lines = vocab(statsRoot(), ["stats"]).out.split("\n");
    expect(lines.slice(4)).toEqual([
      "by category × level: L1 L2 L3 L4 L5 L6 L7 L8 L9 L10  total",
      "  word: 0 0 1 0 0 0 0 0 0 0  1",
      "  idiom: 0 0 0 0 0 0 0 0 0 0  0",
      "  phrasal-verb: 0 0 0 1 1 0 0 0 0 0  2",
      "  phrase: 0 0 0 0 0 0 0 0 0 0  0",
    ]);
  });

  it("prints JSON", () => {
    const stats = jsonOut(vocab(statsRoot(), ["stats", "--json"])) as Record<
      string,
      unknown
    >;
    expect(stats).toMatchObject({
      total: 3,
      shown: 2,
      tombstones: 1,
      byCategoryLevel: { word: { "3": 1 }, "phrasal-verb": { "4": 1, "5": 1 } },
      cells: { total: 40, empty: 37 },
    });
  });
});

describe("cards:dupes --kind vocab", () => {
  function dupesRoot(): string {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [
      makeVocabCard("v_2a2a2a2a"),
      makeVocabCard("v_3a3a3a3a", { headword: "Give up" }),
    ]);
    writeVocab(root, "idiom.json", [
      makeVocabCard("v_4a4a4a4a", { category: "idiom" }),
    ]);
    writeUnder(
      root,
      "tombstones.jsonl",
      `${JSON.stringify({ kind: "vocab", id: "v_9a9a9a9a", category: "phrasal-verb", level: 4, headword: "give up", reason: "x", deletedAt: "2026-09-01" })}\n`,
    );
    return root;
  }

  it("lists cards sharing a headword within a category, with each other and with tombstones", () => {
    expect(vocab(dupesRoot(), ["dupes"]).out.split("\n")).toEqual([
      "v_2a2a2a2a ~ v_3a3a3a3a (card)  phrasal-verb: give up",
      "v_2a2a2a2a ~ v_9a9a9a9a (tombstone)  phrasal-verb: give up",
      "v_3a3a3a3a ~ v_9a9a9a9a (tombstone)  phrasal-verb: Give up",
      "3 duplicate headwords",
    ]);
  });

  it("limits the subjects to --ids and prints JSON", () => {
    expect(
      jsonOut(
        vocab(dupesRoot(), ["dupes", "--ids", "v_4a4a4a4a,v_9z9z9z9z", "--json"]),
      ),
    ).toEqual([]);
  });

  it("checks a writer's draft from --input against the store", () => {
    const root = dupesRoot();
    const input = writeInput(root, "draft.json", [
      { category: "idiom", headword: "GIVE UP" },
    ]);
    expect(jsonOut(vocab(root, ["dupes", "--input", input, "--json"]))).toEqual([
      {
        a: "input[0]",
        b: "v_4a4a4a4a",
        against: "card",
        category: "idiom",
        headword: "GIVE UP",
      },
    ]);
    expect(
      errorCode(
        vocab(root, [
          "dupes",
          "--input",
          writeInput(root, "bad.json", [{ category: "idiom" }]),
        ]).err,
      ),
    ).toBe("ERR_CARDS_INPUT");
    expect(
      errorCode(
        vocab(root, ["dupes", "--input", writeInput(root, "obj.json", {})]).err,
      ),
    ).toBe("ERR_CARDS_INPUT");
  });
});

describe("cards:gaps --kind vocab", () => {
  it("fills the thinnest category × level cells first, at most three each, spread across categories", () => {
    const root = makeContentRoot();
    writeVocab(root, "word.json", [
      makeVocabCard("v_2a2a2a2a", {
        category: "word",
        headword: "borrow",
        example: "Can I {{borrow}} it?",
        level: 3,
      }),
    ]);
    const { plan, planned } = jsonOut(
      vocab(root, ["gaps", "12", "level=3", "--json"]),
    ) as {
      plan: { category: string; level: number; count: number }[];
      planned: number;
    };
    expect(planned).toBe(12);
    expect(
      plan.map(
        (cell) => `${cell.category} L${String(cell.level)} ×${String(cell.count)}`,
      ),
    ).toEqual(["idiom L3 ×3", "phrasal-verb L3 ×3", "phrase L3 ×3", "word L3 ×3"]);
  });

  it("prints a human plan, and warns of a shortfall", () => {
    const root = makeContentRoot();
    const run = vocab(root, ["gaps", "7", "category=word", "level=4-5"]);
    expect(run.out.split("\n")).toHaveLength(3);
    expect(run.out).toMatch(
      /^word L[45] ×3\nword L[45] ×3\n6 vocab cards planned in 2 cells$/u,
    );
    expect(run.err).toMatch(/^WARN cards:gaps planned 6 of 7 vocab cards/u);
  });

  it.each([
    ["no count", []],
    ["a zero count", ["0"]],
  ])("rejects %s", (_label, argv) => {
    expect(errorCode(vocab(makeContentRoot(), ["gaps", ...argv]).err)).toBe(
      "ERR_CARDS_USAGE",
    );
  });
});

describe("cards:new-id --kind vocab", () => {
  it("prints v_ ids unused by any card or tombstone of either kind", () => {
    const root = makeContentRoot();
    writeVocab(root, "phrasal-verb.json", [makeVocabCard("v_2a2a2a2a")]);
    const ids = vocab(root, ["new-id", "3"]).out.split("\n");
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^v_(?:[2-9][a-hjkmnp-z]){4}$/u);
    expect(vocab(root, ["new-id"]).out.split("\n")).toHaveLength(1);
    const exhausted = runCards(root, ["new-id", "--kind", "vocab"], {
      random: () => 0,
    });
    expect(errorCode(exhausted.err)).toBe("ERR_CARDS_ID_SPACE");
  });

  it("rejects a count outside 1–1000", () => {
    expect(errorCode(vocab(makeContentRoot(), ["new-id", "1001"]).err)).toBe(
      "ERR_CARDS_USAGE",
    );
  });
});

describe("vocab write safety", () => {
  it("shares the drill's lock", () => {
    const root = makeContentRoot();
    writeUnder(root, ".cards.lock", "123\n");
    const run = vocab(root, ["add", writeInput(root, "add.json", [makeVocabInput()])]);
    expect(errorCode(run.err)).toBe("ERR_CARDS_BUSY");
    expect(existsSync(path.join(root, "vocab"))).toBe(false);
  });

  it("refuses a vocab file that is not an array", () => {
    const root = makeContentRoot();
    writeUnder(root, "vocab/word.json", "{}\n");
    const run = vocab(root, ["lint"]);
    expect(errorCode(run.err)).toBe("ERR_CARDS_CARD_FILE");
    expect(run.err).toContain("vocab/word.json");
  });
});
