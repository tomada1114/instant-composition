import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openProgressStore, type ProgressStore } from "../src/server/db";
import { makeAnswer } from "./core-fixtures";

const directories: string[] = [];
const stores: ProgressStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function memoryStore(): ProgressStore {
  const store = openProgressStore(":memory:");
  stores.push(store);
  return store;
}

function round(
  id: string,
  overrides: Partial<Parameters<ProgressStore["insertRound"]>[0]> = {},
) {
  return {
    id,
    kind: "today" as const,
    day: "2026-09-22",
    portionDay: "2026-09-22",
    deck: ["c1", "c2"],
    startedAt: 100,
    ...overrides,
  };
}

describe("opening the progress database", () => {
  it("creates the file and its directory, migrated, and reopens it unchanged", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "progress-db-"));
    directories.push(directory);
    const file = path.join(directory, "nested", "progress.sqlite");

    const first = openProgressStore(file);
    first.putSettings({ topics: ["work"], focus: [], dailySize: 10, sound: true });
    const version = first.schemaVersion();
    first.close();

    expect(existsSync(file)).toBe(true);
    const second = openProgressStore(file);
    stores.push(second);
    expect(second.schemaVersion()).toBe(version);
    expect(version).toBeGreaterThanOrEqual(1);
    expect(second.getSettings()).toStrictEqual({
      topics: ["work"],
      focus: [],
      dailySize: 10,
      sound: true,
    });
  });
});

describe("settings", () => {
  it("are absent until saved, then read back as saved", () => {
    const store = memoryStore();
    expect(store.getSettings()).toBeUndefined();
    const settings = {
      topics: ["work", "daily"],
      focus: [{ topic: "work", subtopic: "meetings" }],
      dailySize: 20 as const,
      sound: false,
    };
    store.putSettings(settings);
    expect(store.getSettings()).toStrictEqual(settings);
  });
});

describe("the level", () => {
  it("is the most recent entry of its history", () => {
    const store = memoryStore();
    expect(store.currentLevel()).toBeUndefined();
    store.addLevel({ level: 4, reason: "placement", roundId: "r1", at: 10 });
    store.addLevel({ level: 5, reason: "up", roundId: "r2", at: 20 });
    expect(store.currentLevel()).toStrictEqual({
      level: 5,
      reason: "up",
      roundId: "r2",
      at: 20,
    });
  });
});

describe("rounds", () => {
  it("are stored with their deck and read back", () => {
    const store = memoryStore();
    store.insertRound(round("r1"));
    expect(store.getRound("r1")).toStrictEqual({
      ...round("r1"),
      finishedAt: null,
      abandonedAt: null,
      summary: null,
    });
    expect(store.getRound("missing")).toBeUndefined();
  });

  it("find the one still open today, and rewrite its deck", () => {
    const store = memoryStore();
    store.insertRound(round("done", { startedAt: 1 }));
    store.finishRound("done", 2, { points: 1 });
    store.insertRound(round("open", { startedAt: 3 }));
    store.updateDeck("open", ["c9"]);
    expect(store.activeRound("2026-09-22")?.id).toBe("open");
    expect(store.getRound("open")?.deck).toStrictEqual(["c9"]);
    expect(store.getRound("done")?.summary).toStrictEqual({ points: 1 });
  });

  it("abandon every open round from an earlier day", () => {
    const store = memoryStore();
    store.insertRound(round("old", { day: "2026-09-21" }));
    store.insertRound(round("today"));
    store.abandonOpenRoundsBefore("2026-09-22", 500);
    expect(store.getRound("old")?.abandonedAt).toBe(500);
    expect(store.activeRound("2026-09-21")).toBeUndefined();
    expect(store.activeRound("2026-09-22")?.id).toBe("today");
  });

  it("list the rounds of a day in the order they started", () => {
    const store = memoryStore();
    store.insertRound(round("b", { startedAt: 2 }));
    store.insertRound(round("a", { startedAt: 1 }));
    store.insertRound(round("x", { day: "2026-09-21" }));
    expect(store.roundsOn("2026-09-22").map((row) => row.id)).toStrictEqual(["a", "b"]);
  });
});

describe("answers", () => {
  it("ignore a second insert with the same id", () => {
    const store = memoryStore();
    store.insertRound(round("r1"));
    const answer = makeAnswer({ id: "same", roundId: "r1" });
    expect(store.insertAnswer(answer)).toBe(true);
    expect(store.insertAnswer({ ...answer, result: "ng" })).toBe(false);
    expect(store.allAnswers()).toStrictEqual([answer]);
  });

  it("read back every field in time order", () => {
    const store = memoryStore();
    store.insertRound(round("r1"));
    const later = makeAnswer({ id: "b", roundId: "r1", answeredAt: 20, pass: "retry" });
    const earlier = makeAnswer({
      id: "a",
      roundId: "r1",
      answeredAt: 10,
      result: "timeout",
    });
    store.insertAnswer(later);
    store.insertAnswer(earlier);
    expect(store.allAnswers()).toStrictEqual([earlier, later]);
    expect(store.answersOfRound("r1")).toStrictEqual([earlier, later]);
  });
});

describe("portions", () => {
  it("record a target, change it, and complete once", () => {
    const store = memoryStore();
    store.insertPortion("2026-09-22", 10);
    store.setPortionTarget("2026-09-22", 5);
    expect(store.getPortion("2026-09-22")).toStrictEqual({
      creditDay: "2026-09-22",
      target: 5,
      completedAt: null,
      completedRound: null,
    });
    store.completePortion("2026-09-22", 900, "r1");
    expect(store.completedDays()).toStrictEqual(new Set(["2026-09-22"]));
    expect(store.getPortion("2026-09-22")?.completedRound).toBe("r1");
  });
});

describe("titles", () => {
  it("are kept once each", () => {
    const store = memoryStore();
    store.awardTitle("streak:7", 10, "r1");
    store.awardTitle("streak:7", 20, "r2");
    expect(store.titles()).toStrictEqual([
      { key: "streak:7", awardedAt: 10, roundId: "r1" },
    ]);
  });
});

describe("a transaction", () => {
  it("rolls every write back when its body throws", () => {
    const store = memoryStore();
    expect(() =>
      store.transaction(() => {
        store.insertPortion("2026-09-22", 10);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(store.getPortion("2026-09-22")).toBeUndefined();
  });

  it("returns what its body returns", () => {
    const store = memoryStore();
    expect(store.transaction(() => 42)).toBe(42);
  });
});
