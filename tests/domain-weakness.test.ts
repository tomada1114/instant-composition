import { describe, expect, it } from "vitest";

import {
  TUNING,
  weaknesses,
  type AnswerResult,
  type CardMeta,
  type ItemProgress,
} from "@instant-composition/domain";

import { makeCardMeta, makeItemProgress } from "./domain-fixtures";

const PAST = "en:grammar/past-simple";
const PERFECT = "en:grammar/present-perfect";
const PASSIVE = "en:grammar/passive";

/** Cards `<prefix>1..n` practising `concepts`, each with its latest first pass from `results`. */
function practised(
  prefix: string,
  concepts: readonly string[],
  results: readonly AnswerResult[],
  where: Partial<CardMeta> = {},
): { cards: CardMeta[]; items: ItemProgress[] } {
  const ids = results.map((_, index) => `${prefix}${String(index + 1)}`);
  return {
    cards: ids.map((id) => makeCardMeta(id, { concepts, ...where })),
    items: ids.map((id, index) => makeItemProgress(id, results[index] ?? "ok")),
  };
}

function judge(...groups: { cards: CardMeta[]; items: ItemProgress[] }[]) {
  return weaknesses({
    items: groups.flatMap((group) => group.items),
    shown: new Map(
      groups.flatMap((group) => group.cards).map((card) => [card.id, card]),
    ),
  });
}

describe("the recommended starting tuning", () => {
  it("is weak at 3 seen items and a rate of 0.4, smoothed by 1 miss in 3, keeping 2", () => {
    expect(TUNING.weakness).toStrictEqual({
      minSeen: 3,
      minRate: 0.4,
      prior: { misses: 1, seen: 3 },
      top: 2,
    });
  });
});

describe("a grammar concept is weak", () => {
  it("not below the evidence threshold, however often it was missed", () => {
    expect(judge(practised("p", [PAST], ["ng", "timeout"])).grammar).toStrictEqual([]);
  });

  it("when its misses lift the smoothed rate to the threshold", () => {
    expect(judge(practised("p", [PAST], ["ng", "ng", "ok"])).grammar).toStrictEqual([
      { concept: PAST, seen: 3, misses: 2, rate: 0.5 },
    ]);
  });

  it("at a rate of exactly 0.4", () => {
    const results: AnswerResult[] = ["ng", "ng", "ng", "ok", "ok", "ok", "ok"];
    expect(judge(practised("p", [PAST], results)).grammar).toStrictEqual([
      { concept: PAST, seen: 7, misses: 3, rate: 0.4 },
    ]);
  });

  it.each([
    ["one miss in three", ["ng", "ok", "ok"]],
    ["two misses in five", ["ng", "ng", "ok", "ok", "ok"]],
    ["no miss at all", ["ok", "ok", "ok", "ok"]],
  ] as const)("not with %s, which stays under the rate threshold", (_, results) => {
    expect(judge(practised("p", [PAST], results)).grammar).toStrictEqual([]);
  });

  it.each(["ng", "timeout"] as const)(
    "counting a latest first pass of %s as a miss",
    (miss) => {
      expect(judge(practised("p", [PAST], [miss, miss, "ok"])).grammar).toStrictEqual([
        { concept: PAST, seen: 3, misses: 2, rate: 0.5 },
      ]);
    },
  );

  it("from the latest first pass only, not an earlier miss since corrected", () => {
    const earlierMiss = {
      sessionId: "r0",
      result: "ng",
      elapsedMs: 10_000,
      answeredAt: 1_000,
    } as const;
    const group = practised("p", [PAST], ["ok", "ok", "ok"]);
    const items = group.items.map((item) => ({ ...item, previous: earlierMiss }));
    expect(judge({ cards: group.cards, items }).grammar).toStrictEqual([]);
  });
});

describe("the evidence a weakness is judged on", () => {
  it("leaves out an item whose card is no longer shown", () => {
    const group = practised("p", [PAST], ["ng", "ng", "ok"]);
    const retired = group.cards.slice(1);
    expect(judge({ cards: retired, items: group.items }).grammar).toStrictEqual([]);
  });

  it("leaves out an item with no first pass", () => {
    const group = practised("p", [PAST], ["ng", "ng", "ok"]);
    const items = group.items.map((item, index) =>
      index === 0 ? { ...item, last: null } : item,
    );
    expect(judge({ cards: group.cards, items }).grammar).toStrictEqual([]);
  });

  it("leaves out a shown card the learner has never answered", () => {
    const answered = practised("p", [PAST], ["ng", "ng", "ok"]);
    const unanswered = practised("u", [PAST], ["ok", "ok"]);
    expect(
      judge(answered, { cards: unanswered.cards, items: [] }).grammar,
    ).toStrictEqual([{ concept: PAST, seen: 3, misses: 2, rate: 0.5 }]);
  });

  it("counts a concept a card lists twice once", () => {
    expect(
      judge(practised("p", [PAST, PAST], ["ng", "ng", "ok"])).grammar,
    ).toStrictEqual([{ concept: PAST, seen: 3, misses: 2, rate: 0.5 }]);
  });

  it("counts an item toward every grammar concept its card practises", () => {
    expect(
      judge(practised("p", [PERFECT, PAST], ["ng", "ng", "ok"])).grammar,
    ).toStrictEqual([
      { concept: PAST, seen: 3, misses: 2, rate: 0.5 },
      { concept: PERFECT, seen: 3, misses: 2, rate: 0.5 },
    ]);
  });

  it("ranks only grammar concepts, not other kinds", () => {
    const group = practised("p", ["en:lexeme/borrow"], ["ng", "ng", "ng"]);
    expect(judge(group).grammar).toStrictEqual([]);
  });
});

describe("the ranking", () => {
  it("puts the higher rate first", () => {
    const weaker = practised("a", [PERFECT], ["ng", "ng", "ng"]);
    const weak = practised("b", [PAST], ["ng", "ng", "ok"]);
    expect(judge(weak, weaker).grammar).toStrictEqual([
      { concept: PERFECT, seen: 3, misses: 3, rate: 4 / 6 },
      { concept: PAST, seen: 3, misses: 2, rate: 0.5 },
    ]);
  });

  it("breaks an equal rate by more misses", () => {
    const fewer = practised("a", [PASSIVE], ["ng", "ng", "ok"]);
    const more = practised("b", [PERFECT], ["ng", "ng", "ng", "ok", "ok"]);
    expect(judge(fewer, more).grammar).toStrictEqual([
      { concept: PERFECT, seen: 5, misses: 3, rate: 0.5 },
      { concept: PASSIVE, seen: 3, misses: 2, rate: 0.5 },
    ]);
  });

  it.each([
    ["past simple", [PAST, PASSIVE]],
    ["the passive", [PASSIVE, PAST]],
  ] as const)(
    "breaks an equal rate and equal misses by id, with %s answered first",
    (_, order) => {
      const groups = order.map((concept, index) =>
        practised(String(index), [concept], ["ng", "ng", "ok"]),
      );
      expect(
        judge(...groups).grammar.map((weakness) => weakness.concept),
      ).toStrictEqual([PASSIVE, PAST]);
    },
  );

  it("keeps the two weakest", () => {
    const groups = [
      practised("a", [PAST], ["ng", "ng", "ok"]),
      practised("b", [PERFECT], ["ng", "ng", "ng"]),
      practised("c", [PASSIVE], ["ng", "ng", "ng", "ng"]),
    ];
    expect(judge(...groups).grammar.map((weakness) => weakness.concept)).toStrictEqual([
      PASSIVE,
      PERFECT,
    ]);
  });
});

describe("a subtopic is weak", () => {
  it("by the same rule, placed where its card sits now", () => {
    const group = practised("p", [], ["ng", "ng", "ok"], {
      topic: "travel",
      subtopic: "airport",
    });
    const items = group.items.map((item) => ({
      ...item,
      placement: { topic: "work", subtopic: "meetings" },
    }));
    expect(judge({ cards: group.cards, items }).subtopics).toStrictEqual([
      { topic: "travel", subtopic: "airport", seen: 3, misses: 2, rate: 0.5 },
    ]);
  });

  it("apart from a subtopic of the same name under another topic", () => {
    const home = practised("h", [], ["ng", "ok"], {
      topic: "home",
      subtopic: "chores",
    });
    const work = practised("w", [], ["ng", "ok"], {
      topic: "work",
      subtopic: "chores",
    });
    expect(judge(home, work).subtopics).toStrictEqual([]);
  });
});

describe("a learner with no answers", () => {
  it("has no weaknesses", () => {
    const shown = practised("p", [PAST], ["ok", "ok", "ok"]);
    expect(judge({ cards: shown.cards, items: [] })).toStrictEqual({
      grammar: [],
      subtopics: [],
    });
  });
});
