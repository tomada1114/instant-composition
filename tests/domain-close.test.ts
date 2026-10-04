import { describe, expect, it } from "vitest";

import {
  addDays,
  deal,
  decideAnswers,
  decideClose,
  decideLevel,
  practiceState,
  seededRandom,
  type AnswerInput,
  type CardFacts,
  type CardMeta,
  type CloseState,
  type DifficultyAnswer,
  type ItemProgress,
  type LearnerStats,
  type ReviewEntry,
} from "@instant-composition/domain";

import {
  makeDay,
  makeItem,
  makePortion,
  makeReview,
  makeRound,
  makeSettings,
  makeStats,
} from "./application-fixtures";
import { makeCardMeta } from "./domain-fixtures";

const LEVEL_5 = { level: 5, reason: "placement" as const, roundId: "p0", at: 0 };

function first(
  cardId: string,
  result: "ok" | "ng",
  elapsedMs = 3_000,
  level = 5,
): ReviewEntry {
  return makeReview({
    id: `r1:f:${cardId}`,
    item: { kind: "composition", id: cardId },
    snapshot: { topic: "work", subtopic: "meetings", level, prompt: `${cardId}の文` },
    detail: {
      activity: "composition",
      pass: "first",
      result,
      elapsedMs,
      limitMs: 8_000,
    },
  });
}

function state(overrides: Partial<CloseState> = {}): CloseState {
  return {
    round: makeRound({ deck: ["c1", "c2", "c3"], firstPass: 3 }),
    stats: makeStats({ level: LEVEL_5, openRound: { id: "r1", day: "2026-09-22" } }),
    portion: makePortion({ target: 3, progress: 3 }),
    day: makeDay({ answers: 3, firstPass: 3 }),
    items: new Map(),
    reviews: [first("c1", "ok"), first("c2", "ok"), first("c3", "ok")],
    tallies: new Map([["2026-09-22", makeDay({ answers: 3 })]]),
    catalog: {
      topicOrder: ["work", "travel"],
      chosen: ["work"],
      shown: new Set(["c1", "c2", "c3"]),
      placeOf: () => undefined,
    },
    ...overrides,
  };
}

describe("decideClose", () => {
  it("completes the portion this round took to its target, once", () => {
    const closed = decideClose(state(), 50);
    const again = decideClose(
      state({ portion: makePortion({ target: 3, progress: 3, completedAt: 9 }) }),
      50,
    );
    const short = decideClose(
      state({ portion: makePortion({ target: 4, progress: 3 }) }),
      50,
    );

    expect(closed.portion).toMatchObject({ completedAt: 50, completedRound: "r1" });
    expect(closed.stats).not.toHaveProperty("completedDays");
    expect(closed.stats.streak).toStrictEqual({ schema: 1, longest: 1 });
    expect(closed.outcome).toMatchObject({
      portionCompleted: true,
      filled: "2026-09-22",
    });
    expect(again.portion).toBeUndefined();
    expect(short.portion).toBeUndefined();
    expect(short.outcome.filled).toBeNull();
  });

  it("earns a point per first pass, and the bonus with a completed portion", () => {
    const closed = decideClose(
      state({ stats: makeStats({ points: 7, level: LEVEL_5 }) }),
      50,
    );
    expect(closed.outcome.points).toStrictEqual({ earned: 13, total: 20 });
    expect(closed.stats.points).toBe(20);
  });

  it("finishes the round, clears it as the open one, and counts it on its day", () => {
    const closed = decideClose(state(), 50);
    expect(closed.round).toMatchObject({ finishedAt: 50, outcome: closed.outcome });
    expect(closed.stats.openRound).toBeNull();
    expect(closed.day).toMatchObject({ roundsFinished: 1, lastFinishedRound: "r1" });
    expect(decideClose(state({ day: undefined }), 50).day).toMatchObject({
      answers: 0,
      roundsFinished: 1,
    });
  });

  it("leaves another round open", () => {
    const stats = makeStats({
      level: LEVEL_5,
      openRound: { id: "r2", day: "2026-09-22" },
    });
    expect(decideClose(state({ stats }), 50).stats.openRound).toStrictEqual({
      id: "r2",
      day: "2026-09-22",
    });
  });

  it("sets the level a placement measured, and says whether it was the first", () => {
    const round = makeRound({
      kind: "placement",
      deck: ["c1", "c2", "c3"],
      firstPass: 3,
    });
    const reviews = [
      first("c1", "ok", 1_000, 2),
      first("c2", "ok", 1_000, 4),
      first("c3", "ng", 1_000, 6),
    ];
    const placed = decideClose(state({ round, reviews, stats: makeStats() }), 50);
    const again = decideClose(state({ round, reviews }), 50);

    expect(placed.outcome.placement).toStrictEqual({ level: 4, first: true });
    expect(placed.stats.level).toStrictEqual({
      level: 4,
      reason: "placement",
      roundId: "r1",
      at: 50,
    });
    expect(again.outcome.placement).toStrictEqual({ level: 4, first: false });
  });

  it("moves the level up after fast correct answers a level above, keeping the window", () => {
    const window: DifficultyAnswer[] = Array.from({ length: 20 }, (_, index) => ({
      level: 5 + (index % 2),
      result: "ok",
      elapsedMs: 1_000,
      limitMs: 8_000,
      answeredAt: index,
    }));
    const closed = decideClose(
      state({ stats: makeStats({ level: LEVEL_5, levelWindow: window }) }),
      50,
    );

    expect(closed.outcome.difficulty).toStrictEqual({ change: "up", level: 6 });
    expect(closed.stats.level).toMatchObject({ level: 6, reason: "up" });
    expect(closed.stats.levelWindow).toStrictEqual(window);
  });

  it("starts the window over when a placement measures the level", () => {
    const levelWindow: DifficultyAnswer[] = [
      { level: 5, result: "ok", elapsedMs: 1, limitMs: 8_000, answeredAt: 1 },
    ];
    const round = makeRound({ kind: "placement", deck: ["c1"], firstPass: 1 });
    const placed = decideClose(
      state({
        round,
        reviews: [first("c1", "ok", 1_000, 5)],
        stats: makeStats({ level: LEVEL_5, levelWindow }),
      }),
      50,
    );
    expect(placed.stats.levelWindow).toStrictEqual([]);
  });

  it("keeps the level and its window when the window says nothing yet", () => {
    const levelWindow = [
      { level: 5, result: "ok" as const, elapsedMs: 1, limitMs: 8_000, answeredAt: 1 },
    ];
    const closed = decideClose(
      state({ stats: makeStats({ level: LEVEL_5, levelWindow }) }),
      50,
    );
    expect(closed.outcome.difficulty).toBeNull();
    expect(closed.stats.levelWindow).toStrictEqual(levelWindow);
    expect(
      decideClose(state({ stats: makeStats() }), 50).outcome.difficulty,
    ).toBeNull();
  });

  describe("with a level picked by hand", () => {
    const CHOSEN_5 = { level: 5, reason: "chosen" as const, roundId: null, at: 0 };
    const strong: DifficultyAnswer[] = Array.from({ length: 30 }, (_, index) => ({
      level: 5 + (index % 2),
      result: "ok",
      elapsedMs: 1_000,
      limitMs: 8_000,
      answeredAt: index,
    }));
    const manual = makeStats({
      level: CHOSEN_5,
      levelMode: "manual",
      levelWindow: strong,
    });

    it("keeps it where it is after thirty answers that move an automatic one", () => {
      const auto = decideClose(
        state({ stats: makeStats({ level: LEVEL_5, levelWindow: strong }) }),
        50,
      );
      const kept = decideClose(state({ stats: manual }), 50);

      expect(auto.stats.level).toMatchObject({ level: 6, reason: "up" });
      expect(kept.outcome.difficulty).toBeNull();
      expect(kept.stats.level).toStrictEqual(CHOSEN_5);
      expect(kept.stats.levelMode).toBe("manual");
      expect(kept.stats.levelWindow).toStrictEqual(strong);
    });

    it("adjusts from it again once handed back to the answers", () => {
      const released = decideLevel(manual, { mode: "auto" }, 40);
      if (!released.ok) throw new Error("Switching to auto was refused.");
      const closed = decideClose(state({ stats: released.value }), 50);

      expect(closed.outcome.difficulty).toStrictEqual({ change: "up", level: 6 });
      expect(closed.stats.level).toMatchObject({ level: 6, reason: "up" });
      expect(closed.stats.levelMode).toBe("auto");
    });

    it("hands the level back to the answers when a placement measures it", () => {
      const round = makeRound({ kind: "placement", deck: ["c1"], firstPass: 1 });
      const placed = decideClose(
        state({ round, reviews: [first("c1", "ok", 1_000, 3)], stats: manual }),
        50,
      );

      expect(placed.stats.level).toStrictEqual({
        level: 3,
        reason: "placement",
        roundId: "r1",
        at: 50,
      });
      expect(placed.stats.levelMode).toBe("auto");
      expect(placed.outcome.placement).toStrictEqual({ level: 3, first: false });
    });
  });

  it("lists this round's first-pass misses in the order they were shown", () => {
    const round = makeRound({ deck: ["c3", "c1", "c2"], firstPass: 3 });
    const reviews = [first("c1", "ng"), first("c2", "ok"), first("c3", "ng")];
    expect(decideClose(state({ round, reviews }), 50).outcome.review).toStrictEqual([
      { cardId: "c3", prompt: "c3の文" },
      { cardId: "c1", prompt: "c1の文" },
    ]);
  });

  it("lists the first passes graded again, not those graded hard or good that timed out", () => {
    const graded = (
      cardId: string,
      grade: "again" | "hard" | "good",
      timedOut: boolean,
    ): ReviewEntry => {
      const entry = first(cardId, "ok");
      return {
        ...entry,
        outcome: grade,
        detail: {
          ...entry.detail,
          result: timedOut ? "timeout" : grade === "again" ? "ng" : "ok",
          grade,
          timedOut,
        },
      };
    };
    const round = makeRound({ deck: ["c1", "c2", "c3", "c4"], firstPass: 4 });
    const older = first("c4", "ok");
    const reviews = [
      graded("c1", "again", true),
      graded("c2", "hard", true),
      graded("c3", "good", true),
      { ...older, detail: { ...older.detail, result: "timeout" as const } },
    ];
    expect(decideClose(state({ round, reviews }), 50).outcome.review).toStrictEqual([
      { cardId: "c1", prompt: "c1の文" },
      { cardId: "c4", prompt: "c4の文" },
    ]);
  });

  it("compares each first pass with the item's previous one from an earlier round", () => {
    const item = (
      id: string,
      previous: ItemProgress["previous"],
    ): [string, ItemProgress] => [
      id,
      makeItem({
        item: { kind: "composition", id },
        last: { sessionId: "r1", result: "ok", elapsedMs: 3_000, answeredAt: 10 },
        previous,
      }),
    ];
    const items = new Map([
      item("c1", { sessionId: "r0", result: "ok", elapsedMs: 5_000, answeredAt: 1 }),
      item("c2", { sessionId: "r0", result: "ng", elapsedMs: 5_000, answeredAt: 1 }),
      item("c3", null),
    ]);
    expect(decideClose(state({ items }), 50).outcome.growth).toStrictEqual({
      faster: 1,
      fixed: 1,
      compared: 2,
      firstTime: 1,
      rows: [
        { cardId: "c1", prompt: "c1の文", deltaMs: 2_000, kind: "faster" },
        { cardId: "c2", prompt: "c2の文", deltaMs: 2_000, kind: "fixed" },
      ],
    });
  });

  it("counts mastered items per chosen topic, and titles the milestones crossed", () => {
    const mastered = (id: string, sessionId: string): [string, ItemProgress] => [
      id,
      makeItem({
        item: { kind: "composition", id },
        mastered: { day: "2026-09-22", sessionId },
      }),
    ];
    const items = new Map([
      ...Array.from({ length: 9 }, (_, index) => mastered(`old${String(index)}`, "r0")),
      mastered("c1", "r1"),
    ]);
    const closed = decideClose(state({ items }), 50);

    expect(closed.outcome.reach).toStrictEqual([
      { topic: "work", count: 10, added: 1 },
    ]);
    expect(closed.outcome.titles).toStrictEqual(["reach:work:10"]);
    expect(closed.stats.titles).toStrictEqual(["reach:work:10"]);
  });

  it("counts the unmastered items in chosen topics said in time on exactly one day", () => {
    const items = new Map<string, ItemProgress>([
      ["one", makeItem({ item: { kind: "composition", id: "one" } })],
      [
        "two",
        makeItem({
          item: { kind: "composition", id: "two" },
          okDays: ["2026-09-21", "2026-09-22"],
          mastered: { day: "2026-09-22", sessionId: "r1" },
        }),
      ],
      ["none", makeItem({ item: { kind: "composition", id: "none" }, okDays: [] })],
      [
        "away",
        makeItem({
          item: { kind: "composition", id: "away" },
          placement: { topic: "travel", subtopic: "hotel" },
        }),
      ],
    ]);

    expect(decideClose(state({ items }), 50).outcome.pending).toBe(1);
  });

  it("totals the fourteen days ending with the round's day", () => {
    const tallies = new Map([
      ["2026-09-22", makeDay({ answers: 3 })],
      ["2026-09-09", makeDay({ day: "2026-09-09", answers: 4 })],
      ["2026-09-08", makeDay({ day: "2026-09-08", answers: 9 })],
    ]);
    const { totals } = decideClose(state({ tallies }), 50).outcome;
    expect(totals.last14[0]).toStrictEqual({ day: "2026-09-09", count: 4 });
    expect(totals.last14[13]).toStrictEqual({ day: "2026-09-22", count: 3 });
    expect(totals.added).toBe(3);
  });

  it("sends a learner who made up yesterday back to today, and one who placed on to the rest", () => {
    const yesterday = makeRound({
      kind: "yesterday",
      portionDay: "2026-09-21",
      firstPass: 3,
    });
    const placement = makeRound({ kind: "placement", firstPass: 3 });
    expect(
      decideClose(state({ round: yesterday, portion: undefined }), 50).outcome
        .todayOpen,
    ).toBe(true);
    expect(
      decideClose(
        state({ round: placement, portion: makePortion({ target: 10, progress: 3 }) }),
        50,
      ).outcome.continueToday,
    ).toBe(true);
  });
});

/** How a learner answers a card: right within half its pace, right but slower, or wrong. */
type Answer = "fast" | "slow" | "miss";

/** Forty cards at each level 1..10, eight words each, so a card's pace is eight seconds. */
const LADDER: readonly CardMeta[] = Array.from({ length: 10 }, (_, index) =>
  Array.from({ length: 40 }, (_, n) =>
    makeCardMeta(`L${String(index + 1)}-${String(n + 1)}`, {
      level: index + 1,
      subtopic: `s${String(n % 4)}`,
    }),
  ),
).flat();
const DAY = 86_400_000;

/**
 * Plays one round a day from level `start` for `days` days through the real
 * deal, answer and close, carrying every card's schedule from day to day so
 * due reviews take their share of each deck, and returns the level after each
 * day's round. A round of ten is dealt under ten new cards a day, a larger
 * one under fifteen.
 */
function playDays(
  start: number,
  days: number,
  answer: (card: CardMeta, day: number) => Answer,
  { size = 10, cards = LADDER }: { size?: number; cards?: readonly CardMeta[] } = {},
): number[] {
  const facts = new Map<string, CardFacts>(
    cards.map((card) => [card.id, { ...card, prompt: `${card.id}の文` }]),
  );
  let stats: LearnerStats = makeStats({
    level: { level: start, reason: "placement", roundId: "p0", at: 0 },
  });
  const items = new Map<string, ItemProgress>();
  const levels: number[] = [];
  for (let day = 0; day < days; day += 1) {
    const today = addDays("2026-09-01", day);
    const startedAt = (day + 1) * DAY;
    const dealt = deal(
      practiceState({
        today,
        stats,
        settings: makeSettings({ newPerDay: size > 10 ? 15 : 10 }),
        cards,
        items,
      }),
      { size, seed: `day-${String(day)}` },
    );
    if (!dealt.ok) throw new Error(`Day ${String(day)} could not be dealt.`);
    const round = makeRound({
      id: `r${String(day)}`,
      day: today,
      portionDay: today,
      deck: dealt.value.cardIds,
      startedAt,
    });
    const inputs = round.deck.map((cardId, position): AnswerInput => {
      const card = cards.find((candidate) => candidate.id === cardId);
      if (card === undefined) throw new Error(`${cardId} was never in the catalog.`);
      const given = answer(card, day);
      return {
        id: `${round.id}:${cardId}`,
        roundId: round.id,
        cardId,
        pass: "first",
        result: given === "miss" ? "ng" : "ok",
        elapsedMs: given === "fast" ? 2_000 : 6_000,
        answeredAt: startedAt + position + 1,
      };
    });
    const now = startedAt + 60_000;
    const taken = decideAnswers(
      {
        round,
        stats,
        portion: undefined,
        day: undefined,
        items,
        recorded: new Set(),
        firstCards: new Set(),
      },
      inputs,
      facts,
      now,
    );
    if (taken === undefined) throw new Error(`Day ${String(day)} took no answers.`);
    for (const item of taken.items) items.set(item.item.id, item);
    stats = decideClose(
      {
        round: taken.round,
        stats: taken.stats,
        portion: undefined,
        day: taken.day,
        items,
        reviews: taken.entries,
        tallies: new Map(),
        catalog: {
          topicOrder: ["work"],
          chosen: ["work"],
          shown: new Set(facts.keys()),
          placeOf: () => undefined,
        },
      },
      now,
    ).stats;
    levels.push(stats.level?.level ?? start);
  }
  return levels;
}

/** Right and fast (or `upTo`'s `within`) on every card up to `ability`, wrong on every card above it. */
const upTo =
  (ability: number | ((day: number) => number), within: Answer = "fast") =>
  (card: CardMeta, day: number): Answer =>
    card.level <= (typeof ability === "number" ? ability : ability(day))
      ? within
      : "miss";

/** The first day, counted from 1, the level stood at `level`. */
const dayReaching = (levels: readonly number[], level: number): number =>
  levels.indexOf(level) + 1;

describe("the level over a round of ten a day, reviews included", () => {
  it("climbs from 3 to a learner's level 6 by day 8, and stays there", () => {
    expect(playDays(3, 12, upTo(6))).toStrictEqual([
      3, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6,
    ]);
  });

  it("comes down from 7 to the level a struggling learner clears by day 5, and stays there", () => {
    expect(playDays(7, 12, upTo(4, "slow"))).toStrictEqual([
      6, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 4,
    ]);
  });

  // Main before this change, measured the same way: level 9 on day 18 in both
  // runs below, and level 6 on day 7 in the one above.
  it("climbs from 3 to a learner's level 9 before day 18", () => {
    const levels = playDays(3, 30, upTo(9));
    expect(dayReaching(levels, 9)).toBeGreaterThan(0);
    expect(dayReaching(levels, 9)).toBeLessThan(18);
    expect(levels.slice(dayReaching(levels, 9)).every((level) => level === 9)).toBe(
      true,
    );
  });

  it("follows a learner at 6 who reaches 9 on day 10 there before day 18", () => {
    const levels = playDays(
      6,
      30,
      upTo((day) => (day < 9 ? 6 : 9)),
    );
    expect(levels.slice(0, 9).every((level) => level === 6)).toBe(true);
    expect(dayReaching(levels, 9)).toBeGreaterThan(0);
    expect(dayReaching(levels, 9)).toBeLessThan(18);
  });

  it("moves one step on a round of thirty that alone shows two levels up", () => {
    expect(playDays(3, 1, upTo(9), { size: 30 })).toStrictEqual([4]);
  });

  it("moves one step when the level's own cards run out and the probe makes up the deck", () => {
    const thin = LADDER.filter(
      (card) => ![4, 5, 6].includes(card.level) || card.id.endsWith("-1"),
    );
    expect(playDays(5, 1, upTo(9), { cards: thin })).toStrictEqual([6]);
  });

  /** Wrong, right and slow, or right and fast, a third of the time each or so. */
  const mixedFrom = (seed: number) => {
    const random = seededRandom(`mixed-${String(seed)}`);
    return (): Answer => {
      const roll = random();
      return roll < 0.35 ? "miss" : roll < 0.7 ? "slow" : "fast";
    };
  };

  it.each(Array.from({ length: 40 }, (_, seed) => seed))(
    "moves at most one step on a round of mixed answers (seed %i)",
    (seed) => {
      const [after] = playDays(5, 1, mixedFrom(seed));
      expect(Math.abs((after ?? 0) - 5)).toBeLessThanOrEqual(1);
    },
  );

  it.each(Array.from({ length: 40 }, (_, seed) => seed))(
    "moves at most one step on a round of mixed answers after two steady days (seed %i)",
    (seed) => {
      const mixed = mixedFrom(seed);
      const levels = playDays(5, 3, (card, day) =>
        day < 2 ? upTo(5)(card, day) : mixed(),
      );
      expect(levels.slice(0, 2)).toStrictEqual([5, 5]);
      expect(Math.abs((levels[2] ?? 0) - 5)).toBeLessThanOrEqual(1);
    },
  );
});
