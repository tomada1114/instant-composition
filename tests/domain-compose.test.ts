import { describe, expect, it } from "vitest";

import {
  compose,
  composeExtra,
  countAvailable,
  deal,
  EMPTY_STATS,
  portionSize,
  practiceState,
  retrievability,
  wantedToday,
  type CardMeta,
  type ComposeInput,
  type FsrsState,
  type ItemProgress,
  type SeenCard,
} from "@instant-composition/domain";

import { makeSettings } from "./application-fixtures";
import { makeCardMeta, makeItemProgress } from "./domain-fixtures";

const TODAY = "2026-09-22";

/** `count` cards named `<prefix>1..n` in one cell. */
function cell(
  prefix: string,
  count: number,
  overrides: Partial<CardMeta> = {},
): CardMeta[] {
  return Array.from({ length: count }, (_, index) =>
    makeCardMeta(`${prefix}${String(index + 1)}`, overrides),
  );
}

/** A card scheduled under FSRS, due on `dueDay`, last answered on `lastDay`. */
function scheduled(
  dueDay: string,
  {
    stability = 3,
    lastDay = "2026-09-19",
  }: { stability?: number; lastDay?: string } = {},
): SeenCard {
  const state: FsrsState = {
    stability,
    difficulty: 5,
    reps: 2,
    lapses: 0,
    lastDay,
    dueDay,
  };
  return { state, lastAnsweredAt: 0 };
}

/** A card answered only under Leitner, last at `lastAnsweredAt`. */
function leitner(lastAnsweredAt: number): SeenCard {
  return { state: null, lastAnsweredAt };
}

function seenAll(
  cards: readonly CardMeta[],
  seen: (card: CardMeta, index: number) => SeenCard,
): Map<string, SeenCard> {
  return new Map(cards.map((card, index) => [card.id, seen(card, index)]));
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
    seen: new Map(),
    answeredToday: new Set(),
    newLimit: 10,
    reviewLimit: 20,
    newAnsweredToday: 0,
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

describe("today's queue under the daily limits", () => {
  it("deals twenty reviews and no new card when twenty-six are due under limits of 5 and 20", () => {
    const reviews = cell("r", 26);
    const queue = input({
      cards: [...reviews, ...cell("n", 10)],
      seen: seenAll(reviews, () => scheduled("2026-09-20")),
      newLimit: 5,
      reviewLimit: 20,
      size: 40,
    });
    expect(portionSize(queue, 0)).toBe(20);
    const deck = composed(queue);
    expect(deck).toMatchObject({ reviewCount: 20, newCount: 0 });
    expect(deck.cardIds.every((id) => id.startsWith("r"))).toBe(true);
  });

  it("brings new cards up to the new limit beside a few reviews", () => {
    const reviews = cell("r", 3);
    const deck = composed({
      cards: [...reviews, ...cell("n", 10)],
      seen: seenAll(reviews, () => scheduled(TODAY)),
      newLimit: 5,
      size: 20,
    });
    expect(deck).toMatchObject({ reviewCount: 3, newCount: 5, shortage: true });
  });

  it("holds new cards back as far as reviews fill the review limit", () => {
    const reviews = cell("r", 18);
    const deck = composed({
      cards: [...reviews, ...cell("n", 10)],
      seen: seenAll(reviews, () => scheduled(TODAY)),
      newLimit: 5,
      reviewLimit: 20,
      size: 30,
    });
    expect(deck).toMatchObject({ reviewCount: 18, newCount: 2 });
  });

  it("deals every due review with no review limit", () => {
    const reviews = cell("r", 40);
    const deck = composed({
      cards: [...reviews, ...cell("n", 10)],
      seen: seenAll(reviews, () => scheduled(TODAY)),
      newLimit: 5,
      reviewLimit: "unlimited",
      size: 60,
    });
    expect(deck).toMatchObject({ reviewCount: 40, newCount: 5 });
  });

  it("takes the new cards answered today off the new limit", () => {
    const deck = composed({
      cards: cell("n", 20),
      newLimit: 10,
      newAnsweredToday: 7,
      size: 10,
      minSize: 1,
    });
    expect(deck).toMatchObject({ newCount: 3, reviewCount: 0 });
  });

  it("deals the reviews least likely recalled first, the new cards spread among them", () => {
    const reviews = cell("r", 4);
    const stabilities = [9, 1, 30, 3];
    const seen = seenAll(reviews, (_, index) =>
      scheduled("2026-09-20", { stability: stabilities[index] ?? 1 }),
    );
    const deck = composed({
      cards: [...reviews, ...cell("n", 4)],
      seen,
      newLimit: 2,
    });
    expect(deck.cardIds.filter((id) => id.startsWith("r"))).toStrictEqual([
      "r2",
      "r4",
      "r1",
      "r3",
    ]);
    expect(deck.cardIds.map((id) => id[0])).toStrictEqual([
      "r",
      "r",
      "n",
      "r",
      "r",
      "n",
    ]);
    const recall = (id: string) => {
      const state = seen.get(id)?.state;
      return state === null || state === undefined ? 1 : retrievability(state, TODAY);
    };
    expect(recall("r2")).toBeLessThan(recall("r4"));
  });

  it("deals a card seen only under Leitner as a review, after the scheduled ones, the longest unseen first", () => {
    const reviews = cell("r", 2);
    const old = cell("l", 3);
    const deck = composed({
      cards: [...reviews, ...old, ...cell("n", 10)],
      seen: new Map([
        ...seenAll(reviews, () => scheduled(TODAY)),
        ["l1", leitner(300)],
        ["l2", leitner(100)],
        ["l3", leitner(200)],
      ]),
      newLimit: 0,
    });
    expect(deck.cardIds).toStrictEqual(["r1", "r2", "l2", "l3", "l1"]);
    expect(deck).toMatchObject({ reviewCount: 5, newCount: 0 });
  });

  it("counts cards seen only under Leitner against the review limit, which holds new cards back", () => {
    const old = cell("l", 20);
    const queue = input({
      cards: [...old, ...cell("n", 10)],
      seen: seenAll(old, (_, index) => leitner(index)),
      newLimit: 5,
      reviewLimit: 20,
      size: 30,
    });
    expect(composed(queue)).toMatchObject({ reviewCount: 20, newCount: 0 });
    expect(wantedToday(queue)).toBe(20);
  });

  it("never deals a card not yet due while the queue holds five or more", () => {
    const reviews = cell("r", 3);
    const later = cell("l", 5);
    const queue = input({
      cards: [...reviews, ...later, ...cell("n", 10)],
      seen: new Map([
        ...seenAll(reviews, () => scheduled(TODAY)),
        ...seenAll(later, () => scheduled("2026-09-30")),
      ]),
      newLimit: 5,
    });
    expect(portionSize(queue, 0)).toBe(8);
    const deck = composed({ ...queue, size: 8 });
    expect(deck.cardIds.some((id) => id.startsWith("l"))).toBe(false);
    expect(deck.cardIds).toHaveLength(8);
  });
});

describe("a portion under five", () => {
  const later = cell("l", 6);
  const stabilities = [20, 2, 8, 4, 30, 1];
  const seen = seenAll(later, (_, index) =>
    scheduled("2026-09-30", { stability: stabilities[index] ?? 1 }),
  );

  it("is topped up with cards not yet due, the least likely recalled first", () => {
    const queue = input({
      cards: [...later, ...cell("n", 2)],
      seen,
      newLimit: 2,
    });
    expect(portionSize(queue, 0)).toBe(5);
    const deck = composed({ ...queue, size: 5 });
    expect(deck.cardIds.filter((id) => id.startsWith("l"))).toStrictEqual([
      "l6",
      "l2",
      "l4",
    ]);
    expect(deck).toMatchObject({ newCount: 2, reviewCount: 3, shortage: false });
  });

  it("is not enough when even the cards not yet due leave it under five", () => {
    const queue = input({
      cards: [...later.slice(0, 2), ...cell("n", 2)],
      seen,
      newLimit: 2,
    });
    expect(portionSize(queue, 0)).toBe(4);
    expect(countAvailable(queue)).toBe(4);
    expect(compose({ ...queue, size: 4 })).toStrictEqual({
      ok: false,
      error: { available: 4 },
    });
  });

  it("counts what is done toward the five, never sizing a portion below it", () => {
    const queue = input({ cards: cell("n", 10), newLimit: 3, newAnsweredToday: 3 });
    expect(portionSize(queue, 3)).toBe(3);
    expect(portionSize(input({ cards: cell("n", 10), newLimit: 3 }), 0)).toBe(3);
  });

  it("deals below five when the caller lowers the floor, as a top-up does", () => {
    const deck = composed({ size: 2, minSize: 1, cards: cell("n", 3), newLimit: 3 });
    expect(deck.cardIds).toHaveLength(2);
  });
});

describe("cards already in a deck", () => {
  it("count against today's limits, and the deal goes on after them", () => {
    const reviews = cell("r", 4);
    const queue = input({
      cards: [...reviews, ...cell("n", 10)],
      seen: seenAll(reviews, () => scheduled(TODAY)),
      newLimit: 2,
      reviewLimit: 10,
    });
    const whole = composed(queue).cardIds;
    const first = whole.slice(0, 3);
    const rest = composed({ ...queue, exclude: new Set(first), size: 10, minSize: 1 });
    expect(whole).toHaveLength(6);
    const reviewsIn = (ids: readonly string[]) =>
      ids.filter((id) => id.startsWith("r"));
    expect(first).toStrictEqual(["r1", "r2", "n4"]);
    expect(rest).toMatchObject({ reviewCount: 2, newCount: 1 });
    expect(rest.cardIds.some((id) => first.includes(id))).toBe(false);
    expect([...reviewsIn(first), ...reviewsIn(rest.cardIds)]).toStrictEqual(
      reviewsIn(whole),
    );
  });
});

describe("an extra round", () => {
  it("deals due reviews past the review limit first, then new cards past the new limit", () => {
    const reviews = cell("r", 23);
    const extra = composeExtra({
      ...input({
        cards: [...reviews, ...cell("n", 10), ...cell("l", 3)],
        seen: new Map([
          ...seenAll(reviews, () => scheduled(TODAY)),
          ...seenAll(cell("l", 3), () => scheduled("2026-09-30")),
        ]),
        newLimit: 5,
        reviewLimit: 20,
      }),
    });
    expect(extra.ok && extra.value).toMatchObject({ reviewCount: 3, newCount: 2 });
    expect(extra.ok && extra.value.cardIds.some((id) => id.startsWith("l"))).toBe(
      false,
    );
  });

  it("deals five new cards once today's queue is done", () => {
    const extra = composeExtra(
      input({ cards: cell("n", 20), newLimit: 5, newAnsweredToday: 5 }),
    );
    expect(extra.ok && extra.value).toMatchObject({ reviewCount: 0, newCount: 5 });
  });

  it("is not enough with nothing past today's queue but cards not yet due", () => {
    const later = cell("l", 8);
    expect(
      composeExtra(
        input({ cards: later, seen: seenAll(later, () => scheduled("2026-09-30")) }),
      ),
    ).toStrictEqual({ ok: false, error: { available: 0 } });
  });
});

describe("the levels of the new cards", () => {
  const band = [
    ...cell("a", 10, { level: 4 }),
    ...cell("b", 10, { level: 5 }),
    ...cell("c", 10, { level: 6 }),
    ...cell("d", 10, { level: 7 }),
  ];

  it("split 50/20/20/10 over the level, its two neighbours and a probe two above", () => {
    const cards = [...band, ...cell("e", 10, { level: 8 })];
    const levels = levelsOf(composed({ cards }).cardIds, cards).sort();
    expect(levels).toStrictEqual([4, 4, 5, 5, 5, 5, 5, 6, 6, 7]);
  });

  it("keep a card a level up and a probe among four new cards beside six reviews", () => {
    const reviews = cell("r", 6, { level: 3 });
    const deck = composed({
      cards: [...reviews, ...band],
      seen: seenAll(reviews, () => scheduled(TODAY)),
      newLimit: 4,
    });
    const levels = levelsOf(
      deck.cardIds.filter((id) => !id.startsWith("r")),
      band,
    ).sort();
    expect(deck).toMatchObject({ reviewCount: 6, newCount: 4 });
    expect(levels).toStrictEqual([5, 5, 6, 7]);
  });

  it.each([
    [1, [5]],
    [3, [5, 6, 7]],
    [5, [5, 5, 5, 6, 7]],
  ])("split %i new cards over the bands as %j", (count, expected) => {
    const levels = levelsOf(
      composed({ newLimit: count, minSize: 1, cards: band }).cardIds,
      band,
    ).sort();
    expect(levels).toStrictEqual(expected);
  });

  it("are planned over the focus, weak and remaining shares together", () => {
    const reviews = cell("r", 6, { level: 3 });
    const cards = [...band, ...cell("h", 10, { topic: "daily", subtopic: "home" })];
    const deck = composed({
      cards: [...reviews, ...cards],
      seen: seenAll(reviews, () => scheduled(TODAY)),
      newLimit: 4,
      focus: [{ topic: "daily", subtopic: "home" }],
    });
    const levels = levelsOf(
      deck.cardIds.filter((id) => !id.startsWith("r")),
      cards,
    ).sort();
    expect(deck.focusCount).toBe(2);
    expect(levels).toStrictEqual([5, 5, 6, 7]);
  });

  it("make up the level from the probe only when the level and its neighbours run out", () => {
    const cards = [...cell("b", 3, { level: 5 }), ...cell("d", 10, { level: 7 })];
    const levels = levelsOf(composed({ cards }).cardIds, cards).sort();
    expect(levels).toStrictEqual([5, 5, 5, 7, 7, 7, 7, 7, 7, 7]);
  });

  it("never come from outside the level band or a topic not chosen", () => {
    const cards = [
      ...cell("x", 10, { level: 9 }),
      ...cell("t", 10, { topic: "travel" }),
      ...cell("n", 3),
    ];
    const deck = composed({ cards, minSize: 1 });
    expect(deck.cardIds).toStrictEqual(expect.arrayContaining(["n1", "n2", "n3"]));
    expect(deck.cardIds).toHaveLength(3);
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

describe("the same deal", () => {
  const cards = [
    ...cell("m", 10, { subtopic: "meetings" }),
    ...cell("q", 10, { subtopic: "requests" }),
  ];

  it("is the same for the same seed", () => {
    expect(composed({ cards }).cardIds).toStrictEqual(composed({ cards }).cardIds);
  });

  it("changes with the seed", () => {
    expect(composed({ cards, seed: "a", newLimit: 5 }).cardIds).not.toStrictEqual(
      composed({ cards, seed: "b", newLimit: 5 }).cardIds,
    );
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

  function stateWith(
    items: ReadonlyMap<string, ItemProgress>,
    today = TODAY,
    settings = makeSettings({ newPerDay: 10 }),
  ) {
    return practiceState({
      today,
      stats: {
        ...EMPTY_STATS,
        level: { level: 5, reason: "placement", roundId: null, at: 0 },
      },
      settings,
      cards,
      items,
    });
  }

  it("carries the grammar concepts the learner keeps missing", () => {
    expect(stateWith(missed).weakConcepts).toStrictEqual([WEAK]);
    expect(stateWith(new Map()).weakConcepts).toStrictEqual([]);
  });

  it("hands them to every deal, which takes the three unseen weak cards", () => {
    const dealt = deal(stateWith(missed, "2026-09-23"), { size: 13, seed: "s" });
    expect(
      dealt.ok && dealt.value.cardIds.filter((id) => id.startsWith("w")).sort(),
    ).toStrictEqual(["w1", "w2", "w3", "w4", "w5", "w6"]);
  });

  it("takes the drill's daily limits from the settings, five and twenty unless chosen", () => {
    expect(stateWith(new Map(), TODAY, makeSettings())).toMatchObject({
      newLimit: 5,
      reviewLimit: 20,
    });
    expect(
      stateWith(new Map(), TODAY, makeSettings({ newPerDay: 0, reviewsPerDay: null })),
    ).toMatchObject({ newLimit: 0, reviewLimit: "unlimited" });
  });

  it("counts today's answers against the limits: new ones off the new limit, the rest off the review limit", () => {
    const fresh = makeItemProgress("n1", "ok");
    const reviewed = makeItemProgress("n2", "ok", {
      fsrs: {
        ...fresh.fsrs,
        reps: 2,
        lastDay: TODAY,
        dueDay: "2026-10-01",
      } as FsrsState,
    });
    const reset = makeItemProgress("n3", "ok", {
      memory: { box: 2, dueDay: TODAY, lastDay: "2026-09-18", seenCount: 2 },
    });
    const yesterday = makeItemProgress("n4", "ok", {
      fsrs: { ...fresh.fsrs, lastDay: "2026-09-21", dueDay: "2026-09-24" } as FsrsState,
    });
    const items = new Map(
      [fresh, reviewed, reset, yesterday].map((item) => [item.item.id, item] as const),
    );
    expect(stateWith(items)).toMatchObject({
      answeredToday: new Set(["n1", "n2", "n3"]),
      newAnsweredToday: 1,
      newLimit: 10,
      reviewLimit: 18,
    });
  });

  it("sees an item with Leitner history and no FSRS state as a review with no schedule", () => {
    const { fsrs, ...rest } = makeItemProgress("n1", "ok");
    expect(fsrs).toBeDefined();
    const old: ItemProgress = {
      ...rest,
      memory: { box: 3, dueDay: "2026-10-01", lastDay: "2026-09-10", seenCount: 3 },
    };
    expect(stateWith(new Map([["n1", old]])).seen.get("n1")).toStrictEqual({
      state: null,
      lastAnsweredAt: 2_000,
    });
  });

  it("never deals again today a card answered today under Leitner, counting it a review", () => {
    const { fsrs, ...rest } = makeItemProgress("n1", "ok");
    expect(fsrs).toBeDefined();
    const old: ItemProgress = {
      ...rest,
      memory: { box: 2, dueDay: "2026-09-24", lastDay: TODAY, seenCount: 2 },
    };
    expect(stateWith(new Map([["n1", old]]))).toMatchObject({
      answeredToday: new Set(["n1"]),
      newAnsweredToday: 0,
      reviewLimit: 19,
    });
  });
});
