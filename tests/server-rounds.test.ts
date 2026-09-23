import { afterEach, describe, expect, it } from "vitest";

import { parseHistory } from "../scripts/cards/plan.mjs";
import type { RoundKind } from "../src/core/types";
import type { RoundPayload } from "../src/core/views";
import { removeContentRoots, writeCards } from "./cards-fixture";
import { makeShownCell } from "./progress-fixture";
import { firstPassAnswers, makeHarness, type Harness } from "./services-harness";

const harnesses: Harness[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
  removeContentRoots();
});

function setUp(options: Parameters<typeof makeHarness>[0] = {}): Harness {
  const harness = makeHarness(options);
  harnesses.push(harness);
  const saved = harness.services.updateSettings({ topics: ["work", "daily"] });
  if (!saved.ok) throw new Error(saved.error.code);
  return harness;
}

function start(harness: Harness, kind: RoundKind): RoundPayload {
  const result = harness.services.startRound(kind);
  if (!result.ok) throw new Error(`expected a round, got ${result.error.code}`);
  return result.value;
}

/** Placement, all answered ok, so the level is set and today's portion is done. */
function placed(harness: Harness): void {
  const round = start(harness, "placement");
  const finished = harness.services.finishRound(round.id, firstPassAnswers(round));
  if (!finished.ok) throw new Error(finished.error.code);
}

describe("starting a placement round", () => {
  it("deals one card per level, easiest first, counting toward today", () => {
    const harness = setUp();
    const round = start(harness, "placement");
    const levels = round.deck.map((id) => round.cards[id]?.level);
    expect(levels).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(round).toMatchObject({
      kind: "placement",
      day: "2026-09-23",
      portionDay: "2026-09-23",
      retries: false,
      offset: 0,
      total: 10,
      answered: [],
    });
    expect(round.cards[round.deck[0] ?? ""]?.limitMs).toBe(7_000);
  });

  it("hands back the same open round when asked again", () => {
    const harness = setUp();
    expect(start(harness, "placement").id).toBe(start(harness, "placement").id);
  });
});

describe("starting today's portion", () => {
  it("deals the daily size and records the portion's target", () => {
    const harness = setUp();
    placed(harness);
    harness.setTime(2026, 9, 24, 9);
    const round = start(harness, "today");
    expect(round.deck).toHaveLength(10);
    expect(round).toMatchObject({
      portionDay: "2026-09-24",
      offset: 0,
      total: 10,
      retries: true,
    });
    expect(harness.store.getPortion("2026-09-24")?.target).toBe(10);
  });

  it("resumes where it stopped, with the answers so far", () => {
    const harness = setUp();
    placed(harness);
    harness.setTime(2026, 9, 24, 9);
    const round = start(harness, "today");
    for (const answer of firstPassAnswers(round).slice(0, 4)) {
      expect(harness.services.recordAnswer(answer).ok).toBe(true);
    }
    const resumed = start(harness, "today");
    expect(resumed.id).toBe(round.id);
    expect(resumed.answered).toHaveLength(4);
    expect(harness.services.home().state).toMatchObject({
      kind: "in-progress",
      progress: 4,
      target: 10,
    });
  });

  it("replaces a card that stopped being shown while the round was closed", () => {
    const harness = setUp();
    placed(harness);
    harness.setTime(2026, 9, 24, 9);
    const round = start(harness, "today");
    const answers = firstPassAnswers(round).slice(0, 2);
    for (const answer of answers) harness.services.recordAnswer(answer);
    const dropped = round.deck[5] ?? "";
    const card = round.cards[dropped];
    const file = `${card?.topic ?? ""}/${card?.subtopic ?? ""}.json`;
    const cells = {
      "work/meetings.json": "m",
      "work/requests.json": "q",
      "daily/home.json": "h",
    };
    const prefix = cells[file as keyof typeof cells];
    const rewritten = Array.from({ length: 10 }, (_, index) =>
      makeShownCell(`${prefix}${String(index + 1)}x`, 4, {
        topic: card?.topic,
        subtopic: card?.subtopic,
        level: index + 1,
      }),
    )
      .flat()
      .map((c) => (c["id"] === dropped ? { ...c, stamps: {} } : c));
    writeCards(harness.root, file, rewritten);

    const resumed = start(harness, "today");
    expect(resumed.deck).toHaveLength(10);
    expect(resumed.deck).not.toContain(dropped);
    expect(resumed.deck.slice(0, 2)).toStrictEqual(round.deck.slice(0, 2));
  });

  it("abandons another open round when a different kind starts", () => {
    const harness = setUp();
    placed(harness);
    harness.setTime(2026, 9, 24, 9);
    const today = start(harness, "today");
    const extra = start(harness, "extra");
    expect(extra.id).not.toBe(today.id);
    expect(harness.store.getRound(today.id)?.abandonedAt).not.toBeNull();
  });

  it("leaves a round from an earlier day behind, offering to make that day up", () => {
    const harness = setUp();
    placed(harness);
    harness.setTime(2026, 9, 24, 9);
    const old = start(harness, "today");
    harness.services.recordAnswer(firstPassAnswers(old)[0] ?? ({} as never));
    harness.setTime(2026, 9, 25, 9);
    expect(harness.services.home().state.kind).toBe("recover-offer");
    expect(harness.store.getRound(old.id)?.abandonedAt).not.toBeNull();
    const fresh = start(harness, "today");
    expect(fresh.id).not.toBe(old.id);
    expect(fresh.portionDay).toBe("2026-09-25");
  });

  it("refuses when fewer than five cards can be dealt", () => {
    const harness = setUp({
      cards: (root) => {
        writeCards(root, "work/meetings.json", makeShownCell("m", 3, { level: 1 }));
      },
    });
    expect(harness.services.startRound("placement")).toStrictEqual({
      ok: false,
      error: { code: "ERR_NOT_ENOUGH_CARDS", available: 3 },
    });
  });
});

describe("starting yesterday's portion", () => {
  it("is refused unless yesterday can still be made up", () => {
    const harness = setUp();
    placed(harness);
    harness.setTime(2026, 9, 24, 9);
    expect(harness.services.startRound("yesterday")).toMatchObject({
      ok: false,
      error: { code: "ERR_ROUND_CLOSED" },
    });
  });
});

describe("recording an answer", () => {
  it("stores one answer however often it is sent, stamped with the round's day", () => {
    const harness = setUp();
    const round = start(harness, "placement");
    const answer = firstPassAnswers(round)[0];
    if (answer === undefined) throw new Error("no answer");
    expect(harness.services.recordAnswer(answer)).toStrictEqual({
      ok: true,
      value: undefined,
    });
    expect(harness.services.recordAnswer(answer).ok).toBe(true);
    const stored = harness.store.allAnswers();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ day: "2026-09-23", limitMs: 7_000, level: 1 });
  });

  it("clamps a timeout to the limit", () => {
    const harness = setUp();
    const round = start(harness, "placement");
    const answer = firstPassAnswers(round, ["timeout"])[0];
    if (answer === undefined) throw new Error("no answer");
    harness.services.recordAnswer(answer);
    expect(harness.store.allAnswers()[0]?.elapsedMs).toBe(7_000);
  });

  it.each([
    ["an unknown round", { roundId: "nope" }, "ERR_ROUND_NOT_FOUND"],
    ["a card not in the deck", { cardId: "c_nope" }, "ERR_BAD_REQUEST"],
  ])("refuses %s", (_, override, code) => {
    const harness = setUp();
    const round = start(harness, "placement");
    const answer = { ...firstPassAnswers(round)[0], ...override } as Parameters<
      Harness["services"]["recordAnswer"]
    >[0];
    expect(harness.services.recordAnswer(answer)).toMatchObject({
      ok: false,
      error: { code },
    });
  });

  it("refuses an answer to a finished round", () => {
    const harness = setUp();
    const round = start(harness, "placement");
    const answers = firstPassAnswers(round);
    harness.services.finishRound(round.id, answers);
    expect(
      harness.services.recordAnswer({
        ...answers[0],
        id: "late",
      } as (typeof answers)[0]),
    ).toMatchObject({ ok: false, error: { code: "ERR_ROUND_CLOSED" } });
  });
});

describe("the history for card generation", () => {
  it("has the shape cards:gaps --history reads", () => {
    const harness = setUp();
    placed(harness);
    const history = harness.services.history();
    expect(() => parseHistory(history)).not.toThrow();
    expect(history.seenIds).toHaveLength(10);
    expect(history.topics).toStrictEqual(["work", "daily"]);
    expect(history.estimatedLevel).toBe(10);
  });
});
