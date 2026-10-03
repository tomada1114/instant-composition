import { describe, expect, it } from "vitest";

import {
  checkAnswers,
  decideAnswers,
  scheduleCard,
  type AnswerInput,
  type AnswerResult,
  type AnswersState,
  type CardFacts,
} from "@instant-composition/domain";

import {
  FIRST_GOOD,
  makeDay,
  makeItem,
  makePortion,
  makeRound,
  makeStats,
} from "./application-fixtures";

const DAY_MS = 86_400_000;

// Worked examples against a 5-card round `r1` on 2026-09-22 dealt with a
// 30-second limit, every card eight words long, so the pace "fast" is judged
// by is ceil(4 + 8 * 0.5) = 8 seconds.

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

/** An answer an older client sends, `result: "ok"`; `result: undefined` leaves it out. */
function answer(
  overrides: Omit<Partial<AnswerInput>, "result"> & {
    readonly result?: AnswerResult | undefined;
  } = {},
): AnswerInput {
  const { result, ...rest } = { result: "ok" as const, ...overrides };
  return {
    id: "r1:f:c1",
    roundId: "r1",
    cardId: "c1",
    pass: "first",
    elapsedMs: 3_000,
    ...rest,
    ...(result === undefined ? {} : { result }),
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
    firstCards: new Set(),
    ...overrides,
  };
}

describe("checkAnswers", () => {
  it("answers ERR_ROUND_CLOSED for a new answer to a finished round", () => {
    expect(
      checkAnswers(makeRound({ finishedAt: 5 }), [answer()], CARDS, new Set()),
    ).toStrictEqual({
      ok: false,
      error: { code: "ERR_ROUND_CLOSED" },
    });
  });

  it("accepts a finished round's batch made only of answers it holds", () => {
    const held = answer();
    expect(
      checkAnswers(makeRound({ finishedAt: 5 }), [held], CARDS, new Set([held.id])),
    ).toStrictEqual({ ok: true, value: undefined });
  });

  it("preserves the finished-round rejection for an unrecorded first id", () => {
    expect(
      checkAnswers(
        makeRound({ finishedAt: 5 }),
        [answer()],
        CARDS,
        new Set(["previous-id"]),
      ),
    ).toStrictEqual({ ok: false, error: { code: "ERR_ROUND_CLOSED" } });
  });

  it("refuses an invalid logical duplicate without replacing the adopted answer", () => {
    expect(
      checkAnswers(
        makeRound(),
        [answer({ result: undefined })],
        CARDS,
        new Set(["r1:f:c1"]),
      ),
    ).toStrictEqual({ ok: false, error: { code: "ERR_BAD_REQUEST" } });
  });

  it.each([
    ["another round", answer({ roundId: "r2" })],
    ["a card outside the deck", answer({ cardId: "c9" })],
    ["a card the catalog does not know", answer({ cardId: "c5" })],
    ["no grade and no result", answer({ result: undefined })],
  ])("refuses a batch holding an answer for %s", (_, bad) => {
    const cards = new Map([...CARDS].filter(([id]) => id !== "c5"));
    expect(checkAnswers(makeRound(), [answer(), bad], cards, new Set())).toStrictEqual({
      ok: false,
      error: { code: "ERR_BAD_REQUEST" },
    });
  });

  it("accepts an abandoned round, whose answers still count", () => {
    expect(
      checkAnswers(makeRound({ abandonedAt: 5 }), [answer()], CARDS, new Set()).ok,
    ).toBe(true);
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

  it("adopts one first answer in log order when different ids grade the same card", () => {
    const change = decideAnswers(
      state(),
      [answer({ id: "z", result: "ng" }), answer({ id: "a", result: "ok" })],
      CARDS,
      9_000,
    );
    expect(change?.entries).toHaveLength(1);
    expect(change?.entries[0]).toMatchObject({ id: "a", detail: { result: "ok" } });
    expect(change?.round.firstPass).toBe(1);
    expect(change?.portion?.progress).toBe(1);
    expect(change?.day).toMatchObject({ firstPass: 1, answers: 1 });
    expect(change?.items[0]?.fsrs?.reps).toBe(1);
  });

  it("keeps an adopted first answer when another id arrives, while retaining multiple retries", () => {
    const change = decideAnswers(
      state({ firstCards: new Set(["c1"]) }),
      [
        answer({ id: "other-first", result: "ng" }),
        answer({ id: "retry-a", pass: "retry" }),
        answer({ id: "retry-b", pass: "retry", result: "ng" }),
      ],
      CARDS,
      9_000,
    );
    expect(change?.entries.map((entry) => entry.id)).toStrictEqual([
      "retry-a",
      "retry-b",
    ]);
    expect(change?.round.firstPass).toBe(0);
    expect(change?.portion?.progress).toBe(0);
    expect(change?.day).toMatchObject({ firstPass: 0, answers: 2 });
    expect(change?.items).toStrictEqual([]);
  });

  it("changes nothing for a logical first answer already adopted under another id", () => {
    expect(
      decideAnswers(state({ firstCards: new Set(["c1"]) }), [answer()], CARDS, 9_000),
    ).toBeUndefined();
  });

  const HELD = [
    answer({ elapsedMs: 60_000 }),
    answer({ id: "r1:f:c2", cardId: "c2", result: "timeout", elapsedMs: 10 }),
    answer({ id: "r1:f:c5", cardId: "c5", result: "ng", elapsedMs: 1_000 }),
  ];

  function held(round = makeRound()) {
    return decideAnswers(state({ round }), HELD, CARDS, 9)?.entries.map((entry) => [
      entry.item.id,
      entry.detail.elapsedMs,
      entry.detail.limitMs,
      entry.detail.paceMs,
    ]);
  }

  it("holds the elapsed time to the round's limit, gives a timeout all of it, and works each pace out itself", () => {
    expect(held()).toStrictEqual([
      ["c1", 30_000, 30_000, 8_000],
      ["c2", 30_000, 30_000, 8_000],
      ["c5", 1_000, 30_000, 6_000],
    ]);
  });

  it("holds a late or replayed answer to the limit its round was dealt with, not the setting now", () => {
    expect(held(makeRound({ limitMs: 45_000 }))?.map((row) => row[2])).toStrictEqual([
      45_000, 45_000, 45_000,
    ]);
  });

  it("holds an answer to a round dealt before the limit was a setting to each card's pace", () => {
    const { limitMs, ...before } = makeRound();
    expect(limitMs).toBe(30_000);
    expect(held(before)).toStrictEqual([
      ["c1", 8_000, 8_000, 8_000],
      ["c2", 8_000, 8_000, 8_000],
      ["c5", 1_000, 6_000, 6_000],
    ]);
  });

  it.each([4_000, 4_001])(
    "schedules a ○ flipped in %i ms by its grade alone, fast against the pace or not",
    (elapsedMs) => {
      const change = decideAnswers(
        state({ round: makeRound({ limitMs: 60_000 }) }),
        [answer({ elapsedMs })],
        CARDS,
        9,
      );
      expect(change?.entries[0]).toMatchObject({
        outcome: "good",
        detail: { result: "ok", grade: "good", timedOut: false, paceMs: 8_000 },
      });
      expect(change?.items[0]?.fsrs).toStrictEqual(
        scheduleCard(undefined, "good", "2026-09-22", "c1").state,
      );
    },
  );

  it("takes an older client's timeout as again, timed out, due the next day", () => {
    const change = decideAnswers(
      state(),
      [answer({ result: "timeout", elapsedMs: 0 })],
      CARDS,
      9,
    );
    expect(change?.entries[0]).toMatchObject({
      outcome: "again",
      fsrs: { before: null, after: { lastDay: "2026-09-22", dueDay: "2026-09-23" } },
      detail: { result: "timeout", grade: "again", timedOut: true, elapsedMs: 30_000 },
    });
    expect(change?.items[0]).toMatchObject({ okDays: [], last: { result: "timeout" } });
  });

  it.each([
    ["ok", "good", "2026-09-25"],
    ["ng", "again", "2026-09-23"],
  ] as const)(
    "takes an older client's %s as %s, not timed out",
    (result, grade, dueDay) => {
      const change = decideAnswers(state(), [answer({ result })], CARDS, 9);
      expect(change?.entries[0]?.detail).toMatchObject({
        result,
        grade,
        timedOut: false,
      });
      expect(change?.items[0]?.fsrs?.dueDay).toBe(dueDay);
    },
  );

  it("schedules hard timed out by its grade, and counts it neither said in time nor a hit", () => {
    const change = decideAnswers(
      state(),
      [answer({ result: undefined, grade: "hard", timedOut: true, elapsedMs: 9_000 })],
      CARDS,
      9,
    );
    expect(change?.entries[0]).toMatchObject({
      outcome: "hard",
      detail: { result: "timeout", grade: "hard", timedOut: true, elapsedMs: 30_000 },
    });
    expect(change?.items[0]).toMatchObject({
      fsrs: { reps: 1, lastDay: "2026-09-22", dueDay: "2026-09-24" },
      okDays: [],
      last: { result: "timeout" },
    });
  });

  it("takes a grade over a result an answer also carries", () => {
    const change = decideAnswers(
      state(),
      [answer({ result: "ng", grade: "good" })],
      CARDS,
      9,
    );
    expect(change?.entries[0]?.detail).toMatchObject({ result: "ok", grade: "good" });
  });

  it("schedules a card seen only under Leitner as new from its first answer, keeping its Leitner state", () => {
    const memory = {
      box: 3,
      dueDay: "2026-09-20",
      lastDay: "2026-09-13",
      seenCount: 4,
    };
    const { fsrs, ...seen } = makeItem({ okDays: ["2026-09-10", "2026-09-13"] });
    expect(fsrs).toBeDefined();
    const leitner = { ...seen, memory };
    const change = decideAnswers(
      state({ items: new Map([["c1", leitner]]) }),
      [answer()],
      CARDS,
      9,
    );
    expect(change?.entries[0]).toMatchObject({
      before: memory,
      after: memory,
      fsrs: { before: null, after: { reps: 1, lapses: 0, dueDay: "2026-09-25" } },
    });
    expect(change?.items[0]).toMatchObject({
      memory,
      fsrs: { reps: 1, dueDay: "2026-09-25" },
    });
  });

  it("stamps each answer with the round's day and the server's time", () => {
    const round = makeRound({ day: "2026-09-21" });
    const change = decideAnswers(state({ round }), [answer()], CARDS, 1_234);
    expect(change?.entries[0]).toMatchObject({ day: "2026-09-21", answeredAt: 1_234 });
  });

  it("holds a client's time below the round's start up to the start", () => {
    const change = decideAnswers(state(), [answer({ answeredAt: 5 })], CARDS, 9_000);
    expect(change?.entries[0]?.answeredAt).toBe(1_000);
  });

  it("holds a client's time above the server's down to the server's", () => {
    const change = decideAnswers(
      state(),
      [answer({ answeredAt: 99_000 })],
      CARDS,
      9_000,
    );
    expect(change?.entries[0]?.answeredAt).toBe(9_000);
  });

  it("keeps a client's time between the round's start and the server's", () => {
    const change = decideAnswers(
      state(),
      [answer({ answeredAt: 4_321 })],
      CARDS,
      9_000,
    );
    expect(change?.entries[0]?.answeredAt).toBe(4_321);
  });

  it("orders a batch by the time each answer was given, then by id", () => {
    const change = decideAnswers(
      state(),
      [
        answer({ id: "r1:f:c1", answeredAt: 3_000 }),
        answer({ id: "r1:f:c2", cardId: "c2", answeredAt: 2_000 }),
        answer({ id: "r1:f:c3", cardId: "c3" }),
        answer({ id: "r1:f:c4", cardId: "c4", answeredAt: 2_000 }),
      ],
      CARDS,
      9_000,
    );
    expect(change?.entries.map((entry) => [entry.id, entry.answeredAt])).toStrictEqual([
      ["r1:f:c2", 2_000],
      ["r1:f:c4", 2_000],
      ["r1:f:c1", 3_000],
      ["r1:f:c3", 9_000],
    ]);
  });

  it("records a late answer to a previous day's round on that round's day", () => {
    const round = makeRound({ day: "2026-09-21", startedAt: 1_000 });
    const change = decideAnswers(
      state({ round, portion: makePortion({ day: "2026-09-21" }), day: undefined }),
      [answer({ answeredAt: 2_500 })],
      CARDS,
      DAY_MS,
    );
    expect(change?.entries[0]).toMatchObject({ day: "2026-09-21", answeredAt: 2_500 });
    expect(change?.day.day).toBe("2026-09-21");
    expect(change?.items[0]?.fsrs).toMatchObject({
      lastDay: "2026-09-21",
      dueDay: "2026-09-24",
    });
  });

  it.each([
    ["given later on the day the item last moved on", "2026-09-22"],
    ["given for a day before the one the item last moved on", "2026-09-23"],
  ])("logs a stale answer %s, leaving the item's schedule as it was", (_, lastDay) => {
    const item = makeItem({
      fsrs: { ...FIRST_GOOD, reps: 3, lastDay, dueDay: "2026-09-30" },
      last: { sessionId: "r2", result: "ok", elapsedMs: 2_000, answeredAt: 3_000 },
    });
    const change = decideAnswers(
      state({ items: new Map([["c1", item]]) }),
      [answer({ result: "ng", answeredAt: 5_000 })],
      CARDS,
      9_000,
    );
    expect(change?.items).toStrictEqual([]);
    expect(change?.entries[0]).toMatchObject({
      day: "2026-09-22",
      answeredAt: 5_000,
      outcome: "again",
      before: null,
      after: null,
      fsrs: { before: item.fsrs, after: item.fsrs },
      detail: { grade: "again" },
    });
    expect(change?.round.firstPass).toBe(1);
    expect(change?.day.firstPass).toBe(1);
  });

  it("moves an item on a first pass, and leaves it on a retry", () => {
    const fsrs = { ...FIRST_GOOD, lastDay: "2026-09-20", dueDay: "2026-09-23" };
    const item = makeItem({ fsrs });
    const change = decideAnswers(
      state({ items: new Map([["c1", item]]) }),
      [answer({ id: "r1:r:c2", cardId: "c2", pass: "retry" }), answer()],
      CARDS,
      9_000,
    );
    expect(change?.items.map((progress) => progress.item.id)).toStrictEqual(["c1"]);
    expect(change?.items[0]?.fsrs).toStrictEqual(
      scheduleCard(fsrs, "good", "2026-09-22", "c1").state,
    );
    expect(change?.items[0]?.fsrs).toMatchObject({ reps: 2, dueDay: "2026-10-02" });
  });

  it("logs a re-ask the same day with its grade, and leaves the card's due day as the first answer set it", () => {
    const change = decideAnswers(
      state(),
      [
        answer({ answeredAt: 2_000 }),
        answer({
          id: "r1:r:c1",
          pass: "retry",
          result: undefined,
          grade: "again",
          answeredAt: 3_000,
        }),
      ],
      CARDS,
      9_000,
    );
    const moved = scheduleCard(undefined, "good", "2026-09-22", "c1").state;
    expect(change?.items.map((progress) => progress.fsrs)).toStrictEqual([moved]);
    expect(change?.entries[1]).toMatchObject({
      outcome: "again",
      fsrs: { before: moved, after: moved },
      detail: { pass: "retry", grade: "again", result: "ng" },
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

  it("keeps the newest window of first passes in the level's band, and none before a level", () => {
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
    const at = (level: number) =>
      decideAnswers(
        state({
          stats: {
            ...levelled,
            level: { level, reason: "placement", roundId: "p1", at: 1 },
          },
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
    // Level 5 cards are the probe two above level 3, and two below level 7.
    expect(at(3)?.stats.levelWindow.at(-1)).toMatchObject({ level: 5, answeredAt: 99 });
    expect(at(7)?.stats.levelWindow.at(-1)?.answeredAt).toBe(29);
  });

  it("sorts a late answer into the window by its time, so the newest are kept", () => {
    const full = makeStats({
      level: { level: 5, reason: "placement", roundId: "p1", at: 1 },
      levelWindow: Array.from({ length: 30 }, (_, index) => ({
        level: 5,
        result: "ok" as const,
        elapsedMs: 1,
        limitMs: 8_000,
        answeredAt: 2_000 + index,
      })),
    });

    const change = decideAnswers(
      state({ stats: full }),
      [answer({ answeredAt: 1_500 }), answer({ id: "r1:f:c2", cardId: "c2" })],
      CARDS,
      9_000,
    );

    expect(change?.stats.levelWindow.map((entry) => entry.answeredAt)).toStrictEqual([
      ...Array.from({ length: 29 }, (_, index) => 2_001 + index),
      9_000,
    ]);
  });

  it("keeps an answer from before the last level change out of the window, and one after it in", () => {
    const changed = makeStats({
      level: { level: 5, reason: "up", roundId: "r0", at: 3_000 },
      levelWindow: [],
    });

    const change = decideAnswers(
      state({ stats: changed }),
      [
        answer({ answeredAt: 2_999 }),
        answer({ id: "r1:f:c2", cardId: "c2", answeredAt: 3_000 }),
      ],
      CARDS,
      9_000,
    );

    expect(change?.entries).toHaveLength(2);
    expect(change?.round.firstPass).toBe(2);
    expect(change?.day.firstPass).toBe(2);
    expect(change?.stats.said).toBe(2);
    expect(change?.stats.levelWindow.map((entry) => entry.answeredAt)).toStrictEqual([
      3_000,
    ]);
  });
});
