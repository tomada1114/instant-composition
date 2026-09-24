import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  catalogSnapshotOf,
  type CatalogDocument,
} from "@instant-composition/application";
import { countWords } from "@instant-composition/domain";

import { buildCatalog, CatalogError, main } from "../scripts/catalog/build.mjs";
import { coreHash, isShown } from "../scripts/cards/schema.mjs";
import { DEFAULT_ROOT } from "../scripts/cards/store.mjs";
import { repoRoot, runNode } from "../scripts/lib/node-tools.mjs";
import {
  makeCard,
  makeContentRoot,
  removeContentRoots,
  writeCards,
  writeUnder,
} from "./cards-fixture";

// `pnpm catalog:build` against a throwaway content root and against the real
// content/, always writing into a fresh temporary directory: nothing here
// writes under the repository.

const outs: string[] = [];

afterEach(() => {
  removeContentRoots();
  for (const out of outs.splice(0)) rmSync(out, { recursive: true, force: true });
});

function makeOut(): string {
  const out = mkdtempSync(path.join(tmpdir(), "catalog-test-"));
  outs.push(out);
  return out;
}

function readDocument(out: string): CatalogDocument {
  return JSON.parse(
    readFileSync(path.join(out, "en", "ja.json"), "utf8"),
  ) as CatalogDocument;
}

function stamped(card: Record<string, unknown>): Record<string, unknown> {
  return {
    ...card,
    stamps: {
      core: {
        hash: coreHash(card as Parameters<typeof coreHash>[0]),
        perspectivesVersion: 2,
        at: "2026-09-22",
      },
    },
  };
}

interface Io {
  readonly io: { out: (text: string) => void; err: (text: string) => void };
  readonly out: string[];
  readonly err: string[];
}

function capture(): Io {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out: (text) => {
        out.push(text);
      },
      err: (text) => {
        err.push(text);
      },
    },
    out,
    err,
  };
}

/** A root with a reviewed card, a never-reviewed one, one edited since review, and a tombstone. */
function mixedRoot(): string {
  const root = makeContentRoot();
  const reviewed = stamped(
    makeCard("c_2a3b4c5d", { grammar: ["imperatives", "requests-permission"] }),
  );
  const edited = {
    ...stamped(makeCard("c_4c5d6e7f", { subtopic: "requests", level: 2 })),
    en: "Wait — could you send it again?",
  };
  writeCards(root, "work/meetings.json", [reviewed]);
  writeCards(root, "work/requests.json", [makeCard("c_3b4c5d6e"), edited]);
  writeUnder(
    root,
    "tombstones.jsonl",
    `${JSON.stringify({
      id: "c_9z8y7x6w",
      ja: "削除した文",
      en: "A deleted sentence.",
      topic: "daily",
      subtopic: "home",
      level: 4,
      reason: "duplicate",
      deletedAt: "2026-09-20",
    })}\n`,
  );
  return root;
}

describe("the snapshot built from a content root", () => {
  it("holds the stamped cards as items anchored on the English sentence", () => {
    const out = makeOut();
    buildCatalog({ root: mixedRoot(), out });
    const document = readDocument(out);

    expect(document.items).toStrictEqual([
      {
        id: "c_2a3b4c5d",
        target: "en",
        text: "Let's start the meeting.",
        alternatives: ["Shall we get started?", "Let's get going."],
        concepts: ["en:grammar/imperatives", "en:grammar/requests-permission"],
        level: 1,
        topic: "work",
        subtopic: "meetings",
        localizations: {
          ja: { prompt: "会議を始めましょう。", explanation: "Let's で誘う" },
        },
      },
    ]);
  });

  it("lists every unstamped card as withdrawn, with none of its text", () => {
    const out = makeOut();
    buildCatalog({ root: mixedRoot(), out });
    const document = readDocument(out);

    expect(document.withdrawn).toStrictEqual([
      { id: "c_3b4c5d6e", topic: "work", subtopic: "meetings", level: 1, words: 4 },
      { id: "c_4c5d6e7f", topic: "work", subtopic: "requests", level: 2, words: 6 },
    ]);
    expect(JSON.stringify(document)).not.toContain("send it again");
  });

  it("counts a withdrawn card's words as the drill's timer does", () => {
    const out = makeOut();
    buildCatalog({ root: mixedRoot(), out });
    const words = readDocument(out).withdrawn.find(
      (entry) => entry.id === "c_4c5d6e7f",
    )?.words;

    expect(words).toBe(countWords("Wait — could you send it again?"));
  });

  it("keeps each tombstone's prompt as a ja localization", () => {
    const out = makeOut();
    buildCatalog({ root: mixedRoot(), out });

    expect(readDocument(out).tombstones).toStrictEqual([
      {
        id: "c_9z8y7x6w",
        topic: "daily",
        subtopic: "home",
        level: 4,
        localizations: { ja: { prompt: "削除した文" } },
      },
    ]);
  });

  it("names the pair, its levels with their CEFR bands, concepts and topics", () => {
    const out = makeOut();
    buildCatalog({ root: mixedRoot(), out });
    const document = readDocument(out);

    expect(document).toMatchObject({ format: 1, target: "en", l1: "ja" });
    expect(document.levels).toHaveLength(10);
    expect(document.levels[0]).toStrictEqual({
      level: 1,
      cefr: "A1",
      exams: { toeic: "0", ielts: null, toeflIbt: "0" },
    });
    expect(document.concepts.map((concept) => concept.id)).toStrictEqual([
      "en:grammar/imperatives",
      "en:grammar/requests-permission",
      "en:grammar/past-simple",
      "en:grammar/present-perfect",
    ]);
    expect(document.concepts[0]?.names).toStrictEqual({ ja: "命令文" });
    expect(document.topics).toStrictEqual([
      {
        id: "work",
        names: { ja: "仕事" },
        subtopics: [
          { id: "meetings", names: { ja: "会議" } },
          { id: "requests", names: { ja: "依頼" } },
        ],
      },
      {
        id: "daily",
        names: { ja: "日常" },
        subtopics: [{ id: "home", names: { ja: "家" } }],
      },
    ]);
  });

  it("is versioned by a hash of its content, stable across builds", () => {
    const root = mixedRoot();
    const first = makeOut();
    const second = makeOut();
    buildCatalog({ root, out: first });
    buildCatalog({ root, out: second });
    const version = readDocument(first).version;

    expect(version).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(readDocument(second).version).toBe(version);
    expect(readFileSync(path.join(second, "en", "ja.json"), "utf8")).toBe(
      readFileSync(path.join(first, "en", "ja.json"), "utf8"),
    );
  });

  it("changes its version when a card changes", () => {
    const root = mixedRoot();
    const before = makeOut();
    buildCatalog({ root, out: before });
    writeCards(root, "work/requests.json", [makeCard("c_3b4c5d6e", { level: 2 })]);
    const after = makeOut();
    buildCatalog({ root, out: after });

    expect(readDocument(after).version).not.toBe(readDocument(before).version);
  });
});

describe("the snapshot built from content/", () => {
  const cards = readdirSync(path.join(DEFAULT_ROOT, "cards"), {
    recursive: true,
    encoding: "utf8",
  })
    .filter((file) => file.endsWith(".json"))
    .flatMap(
      (file) =>
        JSON.parse(
          readFileSync(path.join(DEFAULT_ROOT, "cards", file), "utf8"),
        ) as Parameters<typeof isShown>[0][],
    );
  const idOf = (card: object): unknown => (card as { id?: unknown }).id;
  const stampedIds = cards.filter((card) => isShown(card)).map(idOf);
  const unstampedIds = cards.filter((card) => !isShown(card)).map(idOf);

  it("holds every stamped card as an item and no unstamped one", () => {
    const out = makeOut();
    buildCatalog({ root: DEFAULT_ROOT, out });
    const document = readDocument(out);
    const items = document.items.map((item) => item.id);

    expect(stampedIds.length).toBeGreaterThan(0);
    expect([...items].sort()).toStrictEqual([...stampedIds].sort());
    expect(items.filter((id) => unstampedIds.includes(id))).toStrictEqual([]);
    expect(document.withdrawn.map((entry) => entry.id).sort()).toStrictEqual(
      [...unstampedIds].sort(),
    );
  });

  it("gives the application exactly the stamped cards to show for ja", () => {
    const out = makeOut();
    buildCatalog({ root: DEFAULT_ROOT, out });
    const snapshot = catalogSnapshotOf(readDocument(out), "ja");

    expect([...snapshot.shown.keys()].sort()).toStrictEqual([...stampedIds].sort());
    expect(snapshot.levels.get(1)).toStrictEqual({ cefr: "A1+", toeic: "300" });
    expect(snapshot.topics.map((topic) => topic.name)).toContain("日常");
  });
});

describe("pnpm catalog:build", () => {
  it("writes the snapshot under --out and reports it", () => {
    const out = makeOut();
    const run = capture();

    expect(main(["--root", mixedRoot(), "--out", out], run.io)).toBe(0);
    expect(run.err).toStrictEqual([]);
    expect(run.out).toHaveLength(1);
    expect(run.out[0]).toMatch(
      /^Wrote en\/ja\.json: 1 items, 2 withdrawn, 1 tombstones \(sha256:[0-9a-f]{64}\)\.$/u,
    );
  });

  it.each([
    ["an unknown flag", ["--target", "en"]],
    ["a flag without its value", ["--out"]],
    ["an empty value", ["--root", ""]],
  ])("refuses %s", (_, argv) => {
    const run = capture();

    expect(main(argv, run.io)).toBe(1);
    expect(run.err[0]).toMatch(/^ERR_CATALOG_USAGE: /u);
  });

  it("refuses a card that lacks a core field, naming it by file and position", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a3b4c5d", { level: 11 })]);
    const run = capture();

    expect(main(["--root", root, "--out", makeOut()], run.io)).toBe(1);
    expect(run.err[0]).toMatch(/^ERR_CATALOG_CONTENT: /u);
    expect(run.err[0]).toContain("cards/work/meetings.json card #0");
  });

  it("refuses an id used twice", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeCard("c_2a3b4c5d")]);
    writeCards(root, "work/requests.json", [
      makeCard("c_2a3b4c5d", { subtopic: "requests" }),
    ]);

    expect(() => buildCatalog({ root, out: makeOut() })).toThrow(
      expect.objectContaining({ code: "ERR_CATALOG_CONTENT" }),
    );
  });

  it.each([
    ["its CEFR band", "cefr"],
    ["an exam reference", "ielts"],
  ])("refuses a level without %s", (_, key) => {
    const root = makeContentRoot();
    const levels = JSON.parse(readFileSync(path.join(root, "levels.json"), "utf8")) as {
      levels: Record<string, unknown>[];
    };
    const trimmed = levels.levels.map((level, index) =>
      index === 0
        ? Object.fromEntries(Object.entries(level).filter(([name]) => name !== key))
        : level,
    );
    writeFileSync(
      path.join(root, "levels.json"),
      JSON.stringify({ ...levels, levels: trimmed }),
    );

    let caught: unknown;
    try {
      buildCatalog({ root, out: makeOut() });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CatalogError);
    expect((caught as CatalogError).code).toBe("ERR_CATALOG_CONTENT");
  });

  it("reports a content root the card tooling cannot read with its own code", () => {
    const run = capture();

    expect(main(["--root", makeOut(), "--out", makeOut()], run.io)).toBe(1);
    expect(run.err[0]).toMatch(/^ERR_CARDS_CONTENT: /u);
  });

  it("reports an output directory it cannot write to, without its path", () => {
    const out = makeOut();
    writeFileSync(path.join(out, "en"), "a file where a directory goes");
    const run = capture();

    expect(main(["--root", mixedRoot(), "--out", out], run.io)).toBe(1);
    expect(run.err[0]).toMatch(/^ERR_CATALOG_WRITE: /u);
    expect(run.err[0]).not.toContain(out);
  });

  it("runs as a command", () => {
    const out = makeOut();
    const script = fileURLToPath(
      new URL("../scripts/catalog/build.mjs", import.meta.url),
    );
    const run = runNode(script, ["--root", mixedRoot(), "--out", out], {
      cwd: repoRoot,
    });

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(readDocument(out).items).toHaveLength(1);
  });
});
