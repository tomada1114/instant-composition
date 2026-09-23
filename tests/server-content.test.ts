import { rmSync, utimesSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createContentSource, type ContentSnapshot } from "../src/server/content";
import {
  makeCard,
  makeContentRoot,
  removeContentRoots,
  writeCards,
  writeUnder,
} from "./cards-fixture";
import { makeShownCard } from "./progress-fixture";

afterEach(() => {
  removeContentRoots();
});

function load(root: string): ContentSnapshot {
  const result = createContentSource(root).get();
  if (!result.ok) {
    throw new Error(`expected content, got ${result.error.code}`);
  }
  return result.value;
}

describe("reading a content root", () => {
  it("lists the topics and subtopics in taxonomy order", () => {
    const content = load(makeContentRoot());
    expect(content.topics).toStrictEqual([
      {
        id: "work",
        ja: "仕事",
        subtopics: [
          { id: "meetings", ja: "会議" },
          { id: "requests", ja: "依頼" },
        ],
      },
      { id: "daily", ja: "日常", subtopics: [{ id: "home", ja: "家" }] },
    ]);
  });

  it("maps each level to its TOEIC reference", () => {
    const content = load(makeContentRoot());
    expect(content.toeicByLevel.get(1)).toBe("0");
    expect(content.toeicByLevel.size).toBe(10);
  });

  it("shows only cards whose core stamp matches their fields", () => {
    const root = makeContentRoot();
    const edited = { ...makeShownCard("c_2a2a2a2a"), en: "Changed after review." };
    writeCards(root, "work/meetings.json", [
      makeShownCard("c_3b3b3b3b"),
      makeCard("c_4c4c4c4c"),
      edited,
    ]);
    const content = load(root);
    expect([...content.shown.keys()]).toStrictEqual(["c_3b3b3b3b"]);
    expect([...content.known.keys()].sort()).toStrictEqual([
      "c_2a2a2a2a",
      "c_3b3b3b3b",
      "c_4c4c4c4c",
    ]);
    expect(content.shown.get("c_3b3b3b3b")).toMatchObject({
      topic: "work",
      subtopic: "meetings",
      level: 1,
      words: 4,
      en: "Let's start the meeting.",
      alternatives: ["Shall we get started?", "Let's get going."],
    });
  });

  it("skips a malformed card, and a file that is not JSON, and counts them", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [
      makeShownCard("c_3b3b3b3b"),
      { id: "c_5d5d5d5d", ja: "壊れた" },
    ]);
    writeUnder(root, "cards/work/requests.json", "[{ half written");
    const content = load(root);
    expect([...content.shown.keys()]).toStrictEqual(["c_3b3b3b3b"]);
    expect(content.skipped).toBe(2);
  });

  it("reads tombstones and skips a line that is not one", () => {
    const root = makeContentRoot();
    writeUnder(
      root,
      "tombstones.jsonl",
      [
        JSON.stringify({
          id: "c_6e6e6e6e",
          ja: "消えた文",
          en: "Gone.",
          topic: "daily",
          subtopic: "home",
          level: 2,
          reason: "r",
          deletedAt: "2026-09-22",
        }),
        "not json",
        "",
      ].join("\n"),
    );
    const content = load(root);
    expect(content.tombstones.get("c_6e6e6e6e")).toStrictEqual({
      id: "c_6e6e6e6e",
      ja: "消えた文",
      topic: "daily",
      subtopic: "home",
      level: 2,
    });
    expect(content.tombstones.size).toBe(1);
  });

  it("reads no cards from a root without a cards directory", () => {
    const content = load(makeContentRoot());
    expect(content.shown.size).toBe(0);
    expect(content.skipped).toBe(0);
  });

  it("reports a root whose taxonomy cannot be read", () => {
    const root = makeContentRoot();
    rmSync(path.join(root, "taxonomy.json"));
    const result = createContentSource(root).get();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ERR_CONTENT_UNREADABLE");
    }
  });
});

describe("the content cache", () => {
  it("keeps the same snapshot while no file changes", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeShownCard("c_3b3b3b3b")]);
    const source = createContentSource(root);
    const first = source.get();
    expect(source.get()).toBe(first);
  });

  it("reloads once a card file changes", () => {
    const root = makeContentRoot();
    writeCards(root, "work/meetings.json", [makeShownCard("c_3b3b3b3b")]);
    const source = createContentSource(root);
    source.get();
    writeCards(root, "work/meetings.json", [
      makeShownCard("c_3b3b3b3b"),
      makeShownCard("c_7f7f7f7f", { ja: "二枚目", en: "A second card here." }),
    ]);
    const later = new Date(Date.now() + 5_000);
    utimesSync(path.join(root, "cards/work/meetings.json"), later, later);
    const reloaded = source.get();
    expect(reloaded.ok && reloaded.value.shown.size).toBe(2);
  });
});
