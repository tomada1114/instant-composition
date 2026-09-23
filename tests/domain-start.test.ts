import { describe, expect, it } from "vitest";

import {
  decideStart,
  practiceState,
  type CardMeta,
  type ItemProgress,
  type StartState,
} from "@instant-composition/domain";

import {
  makeDay,
  makeItem,
  makePortion,
  makeRound,
  makeSettings,
  makeStats,
} from "./application-fixtures";

const TODAY = "2026-09-22";

/** Forty unseen cards: levels 1 to 10, four at each, in two subtopics. */
const CARDS: CardMeta[] = Array.from({ length: 40 }, (_, index) => ({
  id: `c${String(index)}`,
  topic: "work",
  subtopic: index % 2 === 0 ? "a" : "b",
  level: (index % 10) + 1,
  words: 8,
}));

function state(
  overrides: Partial<StartState> = {},
  practice: { cards?: CardMeta[]; items?: ReadonlyMap<string, ItemProgress> } = {},
): StartState {
  const stats =
    overrides.stats ??
    makeStats({ level: { level: 5, reason: "placement", roundId: "p0", at: 0 } });
  return {
    now: 1_000,
    practice: practiceState({
      today: TODAY,
      stats,
      settings: makeSettings(),
      cards: practice.cards ?? CARDS,
      items: practice.items ?? new Map(),
    }),
    hasSettings: true,
    stats,
    existing: undefined,
    open: undefined,
    openAnswered: new Set(),
    portions: new Map(),
    tally: undefined,
    ...overrides,
  };
}

describe("decideStart", () => {
  it("hands back the round a retried start already made, changing nothing", () => {
    const existing = makeRound({ id: "r9" });
    const decided = decideStart(state({ existing }), { kind: "today", roundId: "r9" });
    expect(decided).toMatchObject({
      ok: true,
      value: { round: existing, created: false, tally: undefined },
    });
  });

  it("refuses a round before the settings exist", () => {
    expect(
      decideStart(state({ hasSettings: false }), { kind: "today", roundId: "r1" }),
    ).toStrictEqual({
      ok: false,
      error: { code: "ERR_BAD_REQUEST" },
    });
  });

  it("answers ERR_ROUND_CLOSED for yesterday when it cannot be made up", () => {
    expect(decideStart(state(), { kind: "yesterday", roundId: "r1" })).toStrictEqual({
      ok: false,
      error: { code: "ERR_ROUND_CLOSED" },
    });
  });

  it("makes up yesterday against yesterday's portion when the day before is completed", () => {
    const stats = makeStats({
      completedDays: ["2026-09-20"],
      level: { level: 5, reason: "placement", roundId: "p0", at: 0 },
    });
    const decided = decideStart(state({ stats }), { kind: "yesterday", roundId: "y1" });
    expect(decided.ok && decided.value.round).toMatchObject({
      kind: "yesterday",
      day: TODAY,
      portionDay: "2026-09-21",
    });
    expect(decided.ok && decided.value.portion).toMatchObject({
      day: "2026-09-21",
      target: 10,
    });
  });

  it("opens today's portion at the daily size and counts the round started", () => {
    const decided = decideStart(state({ tally: makeDay({ roundsStarted: 2 }) }), {
      kind: "today",
      roundId: "t1",
    });
    expect(decided.ok && decided.value).toMatchObject({
      created: true,
      portion: { day: TODAY, target: 10, progress: 0 },
      tally: { roundsStarted: 3 },
      stats: { openRound: { id: "t1", day: TODAY } },
    });
    expect(decided.ok && decided.value.round.deck).toHaveLength(10);
  });

  it("deals only what today's portion still lacks", () => {
    const portions = new Map([
      [TODAY, makePortion({ day: TODAY, target: 10, progress: 7 })],
    ]);
    const decided = decideStart(state({ portions }), { kind: "today", roundId: "t1" });
    expect(decided.ok && decided.value.round.deck).toHaveLength(3);
    expect(decided.ok && decided.value.portion).toBeUndefined();
  });

  it("deals an extra round once today's portion is met or completed", () => {
    const met = new Map([[TODAY, makePortion({ day: TODAY, progress: 10 })]]);
    const completed = makeStats({ completedDays: [TODAY], level: null });
    for (const decided of [
      decideStart(state({ portions: met }), { kind: "today", roundId: "t1" }),
      decideStart(state({ stats: completed }), { kind: "today", roundId: "t1" }),
    ]) {
      expect(decided.ok && decided.value.round).toMatchObject({
        kind: "extra",
        portionDay: null,
      });
    }
  });

  it("answers ERR_NOT_ENOUGH_CARDS when a new portion could not reach the smallest deck", () => {
    expect(
      decideStart(
        state({}, { cards: CARDS.filter((card) => card.level === 5).slice(0, 3) }),
        { kind: "today", roundId: "t1" },
      ),
    ).toStrictEqual({
      ok: false,
      error: { code: "ERR_NOT_ENOUGH_CARDS", available: 3 },
    });
  });

  it("resumes today's open round of the same kind, dropping cards no longer shown", () => {
    const open = makeRound({
      id: "t0",
      kind: "today",
      deck: ["c0", "c1", "gone", "c2"],
    });
    const decided = decideStart(state({ open, openAnswered: new Set(["c0"]) }), {
      kind: "today",
      roundId: "t1",
    });
    expect(decided.ok && decided.value).toMatchObject({
      created: false,
      refitted: true,
      abandoned: undefined,
    });
    const deck = decided.ok ? decided.value.round.deck : [];
    expect(deck.slice(0, 3)).toStrictEqual(["c0", "c1", "c2"]);
    expect(deck).toHaveLength(4);
    expect(deck).not.toContain("gone");
  });

  it("only ever cuts a resumed placement deck", () => {
    const open = makeRound({
      id: "p1",
      kind: "placement",
      portionDay: null,
      deck: ["c0", "gone"],
    });
    const decided = decideStart(state({ open }), { kind: "placement", roundId: "p2" });
    expect(decided.ok && decided.value.round.deck).toStrictEqual(["c0"]);
  });

  it("abandons an open round of another kind, or one left from an earlier day", () => {
    for (const open of [
      makeRound({ id: "e0", kind: "extra", portionDay: null }),
      makeRound({ id: "t0", kind: "today", day: "2026-09-21" }),
    ]) {
      const decided = decideStart(state({ open }), { kind: "today", roundId: "t1" });
      expect(decided.ok && decided.value.abandoned).toMatchObject({
        id: open.id,
        abandonedAt: 1_000,
      });
      expect(decided.ok && decided.value.round.id).toBe("t1");
    }
  });

  it("counts a placement toward today's portion only while that portion is untouched", () => {
    const fresh = decideStart(state(), { kind: "placement", roundId: "p1" });
    const begun = decideStart(
      state({ portions: new Map([[TODAY, makePortion({ day: TODAY, progress: 2 })]]) }),
      { kind: "placement", roundId: "p1" },
    );
    const retarget = decideStart(
      state({ portions: new Map([[TODAY, makePortion({ day: TODAY, target: 5 })]]) }),
      { kind: "placement", roundId: "p1" },
    );
    expect(fresh.ok && fresh.value.round.portionDay).toBe(TODAY);
    expect(fresh.ok && fresh.value.portion?.target).toBe(10);
    expect(begun.ok && begun.value.round.portionDay).toBeNull();
    expect(begun.ok && begun.value.portion).toBeUndefined();
    expect(retarget.ok && retarget.value.portion?.target).toBe(10);
  });

  it("answers ERR_NOT_ENOUGH_CARDS for a placement with too few cards", () => {
    expect(
      decideStart(state({}, { cards: CARDS.slice(0, 2) }), {
        kind: "placement",
        roundId: "p1",
      }),
    ).toStrictEqual({
      ok: false,
      error: { code: "ERR_NOT_ENOUGH_CARDS", available: 2 },
    });
  });

  it("never deals a card already given a first pass today", () => {
    const items = new Map(
      CARDS.filter((card) => card.id !== "c4" && card.id !== "c14").map((card) => [
        card.id,
        makeItem({
          item: { kind: "composition", id: card.id },
          memory: { box: 1, dueDay: "2026-09-23", lastDay: TODAY, seenCount: 1 },
        }),
      ]),
    );
    const decided = decideStart(state({}, { items }), { kind: "extra", roundId: "e1" });
    expect(decided).toStrictEqual({
      ok: false,
      error: { code: "ERR_NOT_ENOUGH_CARDS", available: 2 },
    });
  });
});
