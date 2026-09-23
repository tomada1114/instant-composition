import { describe, expect, it } from "vitest";

import {
  choosePlacement,
  placementLevel,
  type AnswerResult,
  type CardMeta,
  type PlacementInput,
} from "@instant-composition/domain";

import { makeCardMeta } from "./domain-fixtures";

function oneEach(levels: readonly number[], prefix = "L"): CardMeta[] {
  return levels.map((level) => makeCardMeta(`${prefix}${String(level)}`, { level }));
}

function input(overrides: Partial<PlacementInput> = {}): PlacementInput {
  return {
    cards: oneEach([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    topics: ["work"],
    exclude: new Set(),
    seen: new Set(),
    seed: "2026-09-22:placement:0",
    ...overrides,
  };
}

function chosen(overrides: Partial<PlacementInput>): readonly string[] {
  const result = choosePlacement(input(overrides));
  if (!result.ok) {
    throw new Error(`expected a deck, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

describe("choosing the ten placement cards", () => {
  it("takes one card per level, easiest first", () => {
    expect(chosen({})).toStrictEqual([
      "L1",
      "L2",
      "L3",
      "L4",
      "L5",
      "L6",
      "L7",
      "L8",
      "L9",
      "L10",
    ]);
  });

  it("fills a missing level from the nearest one, the lower side first", () => {
    const cards = [
      ...oneEach([1, 2, 4, 5, 6, 7, 8, 9, 10]),
      makeCardMeta("L2b", { level: 2 }),
    ];
    const ids = chosen({ cards });
    expect(ids).toHaveLength(10);
    expect(ids.slice(0, 3).sort()).toStrictEqual(["L1", "L2", "L2b"]);
  });

  it("orders cards of one level by their word count", () => {
    const cards = [
      ...oneEach([1, 4, 5, 6, 7, 8, 9, 10]),
      makeCardMeta("long", { level: 2, words: 9 }),
      makeCardMeta("short", { level: 2, words: 5 }),
    ];
    expect(chosen({ cards }).slice(1, 3)).toStrictEqual(["short", "long"]);
  });

  it("prefers a card not seen before at the same level", () => {
    const cards = [
      ...oneEach([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      makeCardMeta("L5new", { level: 5 }),
    ];
    const ids = chosen({ cards, seen: new Set(["L5"]) });
    expect(ids).toContain("L5new");
    expect(ids).not.toContain("L5");
  });

  it("keeps to the chosen topics and leaves out excluded cards", () => {
    const cards = [
      ...oneEach([1, 2, 3, 4, 5, 6]),
      makeCardMeta("travel", { topic: "travel", level: 7 }),
    ];
    const ids = chosen({ cards, exclude: new Set(["L6"]) });
    expect(ids).toStrictEqual(["L1", "L2", "L3", "L4", "L5"]);
  });

  it("refuses when fewer than five cards can be chosen", () => {
    expect(choosePlacement(input({ cards: oneEach([1, 2, 3, 4]) }))).toStrictEqual({
      ok: false,
      error: { available: 4 },
    });
  });
});

function answer(level: number, result: AnswerResult, elapsedMs: number) {
  return { level, result, elapsedMs, limitMs: 10_000 };
}

describe("the level a placement round sets", () => {
  const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("is the level of the k-th card, k counting solid answers", () => {
    const answers = levels.map((level) =>
      level <= 6 ? answer(level, "ok", 4_000) : answer(level, "ng", 4_000),
    );
    expect(placementLevel(answers)).toBe(6);
  });

  it("does not count a slow ok as solid", () => {
    const answers = levels.map((level) =>
      answer(level, "ok", level <= 3 ? 7_500 : 7_501),
    );
    expect(placementLevel(answers)).toBe(3);
  });

  it("is 1 when nothing was solid", () => {
    expect(
      placementLevel(levels.map((level) => answer(level, "timeout", 10_000))),
    ).toBe(1);
  });

  it("is 10 when everything was", () => {
    expect(placementLevel(levels.map((level) => answer(level, "ok", 1_000)))).toBe(10);
  });

  it("reads the levels in ascending order whatever order they come in", () => {
    const answers = [
      answer(4, "ok", 1_000),
      answer(2, "ok", 1_000),
      answer(2, "ng", 1_000),
    ];
    expect(placementLevel(answers)).toBe(2);
  });
});
