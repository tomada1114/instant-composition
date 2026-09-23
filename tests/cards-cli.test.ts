import { existsSync, readdirSync, readFileSync, rmSync, utimesSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CardsError } from "../scripts/cards/errors.mjs";
import { coreHash } from "../scripts/cards/schema.mjs";
import {
  jsonOut,
  makeCard,
  makeContentRoot,
  makeInput,
  removeContentRoots,
  runCards,
  TAXONOMY,
  writeCards,
  writeInput,
  writeUnder,
} from "./cards-fixture";

// Every `cards:*` command driven in-process through `main`, against a
// throwaway content root. The formatter is a no-op here; the lifecycle suite
// runs the real one.

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
  ])("fails on %s with ERR_CARDS_CONTENT", (_label, file, text) => {
    const root = makeContentRoot();
    writeUnder(root, file, text);
    const run = runCards(root, ["lint"]);
    expect(run.code).toBe(1);
    expect(errorCode(run.err)).toBe("ERR_CARDS_CONTENT");
  });

  it("fails when the perspectives guide is missing", () => {
    const root = makeContentRoot();
    rmSync(path.join(root, "guides", "review-perspectives.md"));
    expect(errorCode(runCards(root, ["lint"]).err)).toBe("ERR_CARDS_CONTENT");
  });

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

  it("breaks a lock older than ten minutes and says so", () => {
    const root = makeContentRoot();
    writeUnder(root, ".cards.lock", "123\n");
    const old = new Date(Date.now() - 11 * 60 * 1000);
    utimesSync(lockPath(root), old, old);
    const run = runCards(root, ["add", writeInput(root, "add.json", [makeInput()])]);
    expect(run.code).toBe(0);
    expect(run.err).toMatch(/^Breaking a stale lock: /u);
    expect(existsSync(lockPath(root))).toBe(false);
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
