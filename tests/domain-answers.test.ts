import { describe, expect, it } from "vitest";

import {
  checkAnswers,
  decideAnswers,
  type AnswerInput,
  type AnswersState,
  type CardFacts,
} from "@instant-composition/domain";

import {
  makeDay,
  makeItem,
  makePortion,
  makeRound,
  makeStats,
} from "./application-fixtures";

// Worked examples against a 5-card round `r1` on 2026-09-22, every card eight
// words long, so the limit is ceil(4 + 8 * 0.5) = 8 seconds.

const CARDS: ReadonlyMap<string, CardFacts> = new Map<string, CardFacts>([
  ...["c1", "c2", "c3", "c4"].map(
    (id) =>
      [
        id,
        {
          topic: "work",
          subtopic: "meetings",
          level: 5,
          prompt: `${id}の文`,
          words: 8,
        },
      ] as const,
  ),
  [
    "c5",
    { topic: "work", subtopic: "meetings", level: 5, prompt: "削除済み", words: null },
  ],
]);

function answer(overrides: Partial<AnswerInput> = {}): AnswerInput {
  return {
    id: "r1:f:c1",
    roundId: "r1",
    cardId: "c1",
    pass: "first",
    result: "ok",
    elapsedMs: 3_000,
    ...overrides,
  };
}

function state(overrides: Partial<AnswersState> = {}): AnswersState {
  return {
    round: makeRound(),
    stats: makeStats(),
    portion: makePortion(),
    day: makeDay(),
    items: new Map(),
    recorded: new Set(),
    ...overrides,
  };
}

describe("checkAnswers", () => {
  it("answers ERR_ROUND_CLOSED for a finished round", () => {
    expect(checkAnswers(makeRound({ finishedAt: 5 }), [answer()], CARDS)).toStrictEqual(
      {
        ok: false,
        error: { code: "ERR_ROUND_CLOSED" },
      },
    );
  });

  it.each([
    ["another round", answer({ roundId: "r2" })],
    ["a card outside the deck", answer({ cardId: "c9" })],
    ["a card the catalog does not know", answer({ cardId: "c5" })],
  ])("refuses a batch holding an answer for %s", (_, bad) => {
    const cards = new Map([...CARDS].filter(([id]) => id !== "c5"));
    expect(checkAnswers(makeRound(), [answer(), bad], cards)).toStrictEqual({
      ok: false,
      error: { code: "ERR_BAD_REQUEST" },
    });
  });

  it("accepts an abandoned round, whose answers still count", () => {
    expect(checkAnswers(makeRound({ abandonedAt: 5 }), [answer()], CARDS).ok).toBe(
      true,
    );
  });
});

describe("decideAnswers", () => {
  it("changes nothing for answers the round already holds", () => {
    expect(
      decideAnswers(state({ recorded: new Set(["r1:f:c1"]) }), [answer()], CARDS, 9),
    ).toBeUndefined();
  });

  it("takes a repeated id once", () => {
    const change = decideAnswers(state(), [answer(), answer()], CARDS, 9);
    expect(change?.entries).toHaveLength(1);
  });

  it("works the limit out itself, holds the elapsed time to it, and gives a timeout all of it", () => {
    const change = decideAnswers(
      state(),
      [
        answer({ elapsedMs: 60_000 }),
        answer({ id: "r1:f:c2", cardId: "c2", result: "timeout", elapsedMs: 10 }),
        answer({ id: "r1:f:c5", cardId: "c5", result: "ng", elapsedMs: 1_000 }),
      ],
      CARDS,
      9,
    );
    expect(
      change?.entries.map((entry) => [
        entry.item.id,
        entry.detail.elapsedMs,
        entry.detail.limitMs,
      ]),
    ).toStrictEqual([
      ["c1", 8_000, 8_000],
      ["c2", 8_000, 8_000],
      ["c5", 1_000, 6_000],
    ]);
  });

  it("stamps each answer with the round's day and the server's time", () => {
    const round = makeRound({ day: "2026-09-21" });
    const change = decideAnswers(state({ round }), [answer()], CARDS, 1_234);
    expect(change?.entries[0]).toMatchObject({ day: "2026-09-21", answeredAt: 1_234 });
  });

  it("moves an item on a first pass, and leaves it on a retry", () => {
    const item = makeItem({
      memory: { box: 2, dueDay: "2026-09-24", lastDay: "2026-09-20", seenCount: 2 },
    });
    const change = decideAnswers(
      state({ items: new Map([["c1", item]]) }),
      [answer({ id: "r1:r:c2", cardId: "c2", pass: "retry" }), answer()],
      CARDS,
      9,
    );
    expect(change?.items.map((progress) => progress.item.id)).toStrictEqual(["c1"]);
    expect(change?.items[0]?.memory).toStrictEqual({
      box: 4,
      dueDay: "2026-10-06",
      lastDay: "2026-09-22",
      seenCount: 3,
    });
  });

  it("counts first passes toward the round, the portion and the day, and every answer toward the totals", () => {
    const change = decideAnswers(
      state({
        day: makeDay({ answers: 3, firstPass: 2 }),
        stats: makeStats({ said: 3, practicedDays: 1, firstDay: "2026-09-20" }),
      }),
      [
        answer(),
        answer({ id: "r1:r:c1", pass: "retry" }),
        answer({ id: "r1:f:c2", cardId: "c2" }),
      ],
      CARDS,
      9,
    );
    expect(change?.round.firstPass).toBe(2);
    expect(change?.portion?.progress).toBe(2);
    expect(change?.day).toMatchObject({ answers: 6, firstPass: 4 });
    expect(change?.stats).toMatchObject({
      said: 6,
      practicedDays: 1,
      firstDay: "2026-09-20",
    });
  });

  it("counts a practiced day and a first day on the day's first answer", () => {
    const change = decideAnswers(state({ day: undefined }), [answer()], CARDS, 9);
    expect(change?.stats).toMatchObject({ practicedDays: 1, firstDay: "2026-09-22" });
    expect(change?.day).toMatchObject({
      day: "2026-09-22",
      answers: 1,
      roundsStarted: 0,
    });
  });

  it("leaves an extra round's answers out of every portion", () => {
    const change = decideAnswers(state({ portion: undefined }), [answer()], CARDS, 9);
    expect(change?.portion).toBeUndefined();
  });

  it("keeps the newest window of first passes near the current level, and none before a level", () => {
    const levelled = makeStats({
      level: { level: 4, reason: "placement", roundId: "p1", at: 1 },
      levelWindow: Array.from({ length: 30 }, (_, index) => ({
        level: 3,
        result: "ng" as const,
        elapsedMs: 1,
        limitMs: 8_000,
        answeredAt: index,
      })),
    });
    const inputs = [answer(), answer({ id: "r1:f:c2", cardId: "c2" })];

    const near = decideAnswers(state({ stats: levelled }), inputs, CARDS, 99);
    const far = decideAnswers(
      state({
        stats: { ...levelled, level: { level: 8, reason: "up", roundId: "r0", at: 1 } },
      }),
      inputs,
      CARDS,
      99,
    );
    const none = decideAnswers(state(), inputs, CARDS, 99);

    expect(near?.stats.levelWindow).toHaveLength(30);
    expect(near?.stats.levelWindow.at(-1)).toMatchObject({ level: 5, answeredAt: 99 });
    expect(near?.stats.levelWindow[0]?.answeredAt).toBe(2);
    expect(far?.stats.levelWindow).toHaveLength(30);
    expect(far?.stats.levelWindow.at(-1)?.answeredAt).toBe(29);
    expect(none?.stats.levelWindow).toStrictEqual([]);
  });
});
