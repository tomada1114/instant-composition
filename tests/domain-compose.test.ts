import { describe, expect, it } from "vitest";

import {
  compose,
  countAvailable,
  deal,
  EMPTY_STATS,
  practiceState,
  type CardMeta,
  type CardState,
  type ComposeInput,
  type ItemProgress,
} from "@instant-composition/domain";
import { makeCardMeta, makeItemProgress } from "./domain-fixtures";

const TODAY = "2026-09-22";

/** `count` unseen cards named `<prefix>1..n` in one cell. */
function cell(
  prefix: string,
  count: number,
  overrides: Partial<CardMeta> = {},
): CardMeta[] {
  return Array.from({ length: count }, (_, index) =>
    makeCardMeta(`${prefix}${String(index + 1)}`, overrides),
  );
}

function due(dueDay: string, box = 1, lastDay = "2026-09-20"): CardState {
  return { box, dueDay, lastDay, seenCount: 1 };
}

function input(overrides: Partial<ComposeInput> = {}): ComposeInput {
  return {
    size: 10,
    today: TODAY,
    level: 5,
    topics: ["work", "daily"],
    focus: [],
    weakConcepts: [],
    cards: [],
    states: new Map(),
    exclude: new Set(),
    seed: `${TODAY}:today:0`,
    ...overrides,
  };
}

function composed(overrides: Partial<ComposeInput>) {
  const result = compose(input(overrides));
  if (!result.ok) {
    throw new Error(`expected a deck, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function levelsOf(ids: readonly string[], cards: readonly CardMeta[]): number[] {
  return ids.map((id) => cards.find((card) => card.id === id)?.level ?? 0);
}

describe("the cards that can be dealt", () => {
  it("counts seen cards at any level and unseen ones only in the level band", () => {
    const cards = [
      makeCardMeta("seen-far", { level: 1 }),
      makeCardMeta("new-below", { level: 4 }),
      makeCardMeta("new-probe", { level: 7 }),
      makeCardMeta("new-under", { level: 3 }),
      makeCardMeta("new-over", { level: 8 }),
      makeCardMeta("other-topic", { topic: "travel", level: 5 }),
      makeCardMeta("excluded", { level: 5 }),
    ];
    const available = countAvailable(
      input({
        cards,
        states: new Map([["seen-far", due("2026-10-30")]]),
        exclude: new Set(["excluded"]),
      }),
    );
    expect(available).toBe(3);
  });
});

describe("the mix of review and new cards", () => {
  it("caps reviews at 60% and takes the earliest due first", () => {
    const reviews = cell("r", 10);
    const states = new Map(
      reviews.map((card, index) => [card.id, due(`2026-09-${String(10 + index)}`)]),
    );
    const deck = composed({ cards: [...reviews, ...cell("n", 10)], states });
    expect(deck.reviewCount).toBe(6);
    expect(deck.newCount).toBe(4);
    expect(deck.cardIds.filter((id) => id.startsWith("r")).sort()).toStrictEqual([
      "r1",
      "r2",
      "r3",
      "r4",
      "r5",
      "r6",
    ]);
  });

  it("orders ties in due day by the smaller box, then the older last day", () => {
    const cards = cell("r", 3);
    const states = new Map([
      ["r1", due("2026-09-20", 3, "2026-09-10")],
      ["r2", due("2026-09-20", 1, "2026-09-18")],
      ["r3", due("2026-09-20", 1, "2026-09-12")],
    ]);
    // floor(3 * 0.6) = 1 review slot, and five new cards leave nothing to back-fill.
    const deck = composed({
      size: 3,
      minSize: 1,
      cards: [...cards, ...cell("n", 5)],
      states,
    });
    expect(deck.cardIds.filter((id) => id.startsWith("r"))).toStrictEqual(["r3"]);
  });

  it("fills the rest with new cards when few reviews are due", () => {
    const deck = composed({
      cards: [...cell("r", 2), ...cell("n", 20)],
      states: new Map([
        ["r1", due(TODAY)],
        ["r2", due("2026-09-01")],
      ]),
    });
    expect(deck).toMatchObject({ reviewCount: 2, newCount: 8, shortage: false });
  });

  it("splits new cards 50/20/20/10 over the level, its two neighbours and a probe two above", () => {
    const cards = [
      ...cell("a", 10, { level: 4 }),
      ...cell("b", 10, { level: 5 }),
      ...cell("c", 10, { level: 6 }),
      ...cell("d", 10, { level: 7 }),
      ...cell("e", 10, { level: 8 }),
    ];
    const levels = levelsOf(composed({ cards }).cardIds, cards).sort();
    expect(levels).toStrictEqual([4, 4, 5, 5, 5, 5, 5, 6, 6, 7]);
  });

  it("deals no probe in a deck too small for a tenth of it", () => {
    const cards = [
      ...cell("a", 10, { level: 4 }),
      ...cell("b", 10, { level: 5 }),
      ...cell("c", 10, { level: 6 }),
      ...cell("d", 10, { level: 7 }),
    ];
    const levels = levelsOf(composed({ size: 9, cards }).cardIds, cards);
    expect(levels).not.toContain(7);
  });

  it("makes up the level from the probe only when the level and its neighbours run out", () => {
    const cards = [...cell("b", 3, { level: 5 }), ...cell("d", 10, { level: 7 })];
    const levels = levelsOf(composed({ cards }).cardIds, cards).sort();
    expect(levels).toStrictEqual([5, 5, 5, 7, 7, 7, 7, 7, 7, 7]);
  });

  it("borrows a missing band's share from the level first", () => {
    const cards = [...cell("a", 10, { level: 4 }), ...cell("b", 10, { level: 5 })];
    const levels = levelsOf(composed({ cards }).cardIds, cards).sort();
    expect(levels).toStrictEqual([4, 4, 5, 5, 5, 5, 5, 5, 5, 5]);
  });

  it("borrows from a neighbour when the level itself runs out", () => {
    const cards = [...cell("a", 10, { level: 4 }), ...cell("b", 2, { level: 5 })];
    const levels = levelsOf(composed({ cards }).cardIds, cards).sort();
    expect(levels).toStrictEqual([4, 4, 4, 4, 4, 4, 4, 4, 5, 5]);
  });
});

describe("focus subtopics", () => {
  const cards = [
    ...cell("m", 10, { subtopic: "meetings" }),
    ...cell("q", 10, { subtopic: "requests" }),
    ...cell("h", 10, { topic: "daily", subtopic: "home" }),
  ];

  it("take up to half of the new cards", () => {
    const deck = composed({ cards, focus: [{ topic: "daily", subtopic: "home" }] });
    expect(deck.focusCount).toBe(5);
    expect(
      deck.cardIds.filter((id) => id.startsWith("h")).length,
    ).toBeGreaterThanOrEqual(5);
  });

  it("share the focus half between two subtopics", () => {
    const deck = composed({
      cards,
      focus: [
        { topic: "daily", subtopic: "home" },
        { topic: "work", subtopic: "requests" },
      ],
    });
    expect(deck.focusCount).toBe(5);
    expect(
      deck.cardIds.filter((id) => id.startsWith("h")).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      deck.cardIds.filter((id) => id.startsWith("q")).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("report none when no focus is set", () => {
    expect(composed({ cards }).focusCount).toBe(0);
  });
});

describe("filling a short deck", () => {
  it("adds more due reviews when new cards run short", () => {
    const reviews = cell("r", 10);
    const states = new Map(reviews.map((card) => [card.id, due("2026-09-20")]));
    const deck = composed({ cards: [...reviews, ...cell("n", 1)], states });
    expect(deck).toMatchObject({ reviewCount: 9, newCount: 1, shortage: false });
  });

  it("then adds seen cards not yet due, nearest due day first", () => {
    const cards = cell("s", 12);
    const states = new Map(
      cards.map((card, index) => [card.id, due(`2026-10-${String(10 + index)}`)]),
    );
    const deck = composed({ cards, states });
    expect(deck.reviewCount).toBe(10);
    expect([...deck.cardIds].sort()).toStrictEqual([
      "s1",
      "s10",
      "s2",
      "s3",
      "s4",
      "s5",
      "s6",
      "s7",
      "s8",
      "s9",
    ]);
  });

  it("deals what there is, marked short, when at least five are available", () => {
    const deck = composed({ cards: cell("n", 7) });
    expect(deck.cardIds).toHaveLength(7);
    expect(deck.shortage).toBe(true);
  });

  it("refuses to deal fewer than five, reporting how many there were", () => {
    expect(compose(input({ cards: cell("n", 4) }))).toStrictEqual({
      ok: false,
      error: { available: 4 },
    });
  });

  it("deals below five when the caller lowers the floor, as a top-up does", () => {
    const deck = composed({ size: 2, minSize: 1, cards: cell("n", 3) });
    expect(deck.cardIds).toHaveLength(2);
  });
});

describe("what never enters a deck", () => {
  it("leaves out excluded cards and topics not chosen", () => {
    const cards = [...cell("n", 10), ...cell("t", 10, { topic: "travel" })];
    const deck = composed({ cards, exclude: new Set(["n1", "n2"]), size: 8 });
    expect(deck.cardIds).not.toContain("n1");
    expect(deck.cardIds).not.toContain("n2");
    expect(deck.cardIds.some((id) => id.startsWith("t"))).toBe(false);
  });
});

describe("the order of a deck", () => {
  const cards = [
    ...cell("m", 10, { subtopic: "meetings" }),
    ...cell("q", 10, { subtopic: "requests" }),
  ];

  it("is the same for the same seed", () => {
    expect(composed({ cards }).cardIds).toStrictEqual(composed({ cards }).cardIds);
  });

  it("changes with the seed", () => {
    expect(composed({ cards, seed: "a" }).cardIds).not.toStrictEqual(
      composed({ cards, seed: "b" }).cardIds,
    );
  });

  it("keeps the same subtopic from sitting side by side when it can", () => {
    const ids = composed({ cards }).cardIds;
    const adjacent = ids
      .slice(1)
      .filter((id, index) => id.startsWith(ids[index]?.[0] ?? "-"));
    expect(adjacent).toStrictEqual([]);
  });
});

describe("weak grammar concepts", () => {
  const WEAK = "en:grammar/passive";
  const OTHER = "en:grammar/imperatives";
  const plain = cell("n", 30, { concepts: [OTHER] });
  const tagged = cell("w", 3, { concepts: [WEAK] });
  const weakIn = (ids: readonly string[]) => ids.filter((id) => id.startsWith("w"));

  it("steer the same seed to a different deck holding weak-tagged new cards", () => {
    const cards = [...plain, ...tagged];
    const without = composed({ cards });
    const weak = composed({ cards, weakConcepts: [WEAK] });

    expect(weak.cardIds).not.toStrictEqual(without.cardIds);
    expect(weakIn(without.cardIds).length).toBeLessThan(3);
    expect(weakIn(weak.cardIds).sort()).toStrictEqual(["w1", "w2", "w3"]);
    expect(weak).toMatchObject({ newCount: 10, weakCount: 3, weakConcepts: [WEAK] });
    expect(without).toMatchObject({ weakCount: 0, weakConcepts: [] });
  });

  it("come after the focus share, which keeps its half", () => {
    const cards = [
      ...cell("h", 10, { topic: "daily", subtopic: "home", concepts: [OTHER] }),
      ...plain,
      ...tagged,
    ];
    const deck = composed({
      cards,
      focus: [{ topic: "daily", subtopic: "home" }],
      weakConcepts: [WEAK],
    });
    expect(deck.focusCount).toBe(5);
    expect(weakIn(deck.cardIds)).toHaveLength(3);
  });

  it("share the weak share between the top two concepts", () => {
    const second = "en:grammar/conditionals";
    const deck = composed({
      cards: [
        ...plain,
        ...cell("w", 5, { concepts: [WEAK] }),
        ...cell("c", 5, { concepts: [second] }),
      ],
      weakConcepts: [WEAK, second],
    });
    expect(weakIn(deck.cardIds).length).toBeGreaterThanOrEqual(2);
    expect(
      deck.cardIds.filter((id) => id.startsWith("c")).length,
    ).toBeGreaterThanOrEqual(1);
    expect(deck.weakConcepts).toStrictEqual([WEAK, second]);
  });

  it("draw nothing from outside the level band", () => {
    const deck = composed({
      cards: [...plain, ...cell("w", 3, { concepts: [WEAK], level: 8 })],
      weakConcepts: [WEAK],
    });
    expect(deck).toMatchObject({ weakCount: 0, weakConcepts: [] });
  });

  it("put a weak review first among reviews due the same day", () => {
    const cards = [
      makeCardMeta("r1", { concepts: [OTHER] }),
      makeCardMeta("r2", { concepts: [WEAK] }),
      makeCardMeta("r3", { concepts: [OTHER] }),
    ];
    const states = new Map([
      ["r1", due("2026-09-20", 1, "2026-09-12")],
      ["r2", due("2026-09-20", 3, "2026-09-18")],
      ["r3", due("2026-09-19", 4, "2026-09-18")],
    ]);
    // floor(4 * 0.6) = 2 review slots: the earlier due day first, then the weak tie.
    const deck = composed({
      size: 4,
      minSize: 1,
      cards: [...cards, ...cell("n", 5, { concepts: [OTHER] })],
      states,
      weakConcepts: [WEAK],
    });
    expect(deck.cardIds.filter((id) => id.startsWith("r")).sort()).toStrictEqual([
      "r2",
      "r3",
    ]);
  });
});

describe("the dealing state", () => {
  const WEAK = "en:grammar/passive";
  const cards = [
    ...cell("w", 6, { concepts: [WEAK] }),
    ...cell("n", 20, { concepts: ["en:grammar/imperatives"] }),
  ];
  const missed = new Map(
    ["w1", "w2", "w3"].map((id) => [id, makeItemProgress(id, "ng")] as const),
  );

  function stateWith(items: ReadonlyMap<string, ItemProgress>) {
    return practiceState({
      today: TODAY,
      stats: {
        ...EMPTY_STATS,
        level: { level: 5, reason: "placement", roundId: null, at: 0 },
      },
      settings: { topics: ["work"], focus: [], dailySize: 10, sound: true },
      cards,
      items,
    });
  }

  it("carries the grammar concepts the learner keeps missing", () => {
    expect(stateWith(missed).weakConcepts).toStrictEqual([WEAK]);
    expect(stateWith(new Map()).weakConcepts).toStrictEqual([]);
  });

  it("hands them to every deal, which takes the three unseen weak cards", () => {
    const dealt = deal(stateWith(missed), { size: 10, seed: "s" });
    expect(
      dealt.ok && dealt.value.cardIds.filter((id) => id.startsWith("w")).sort(),
    ).toStrictEqual(["w4", "w5", "w6"]);
  });
});
