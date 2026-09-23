import { afterEach, describe, expect, it } from "vitest";

import type { RoundKind } from "../src/core/types";
import type { RoundPayload, RoundSummary } from "../src/core/views";
import { removeContentRoots, TAXONOMY } from "./cards-fixture";
import { firstPassAnswers, makeHarness, type Harness } from "./services-harness";

const harnesses: Harness[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
  removeContentRoots();
});

function setUp(): Harness {
  const harness = makeHarness();
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

function play(harness: Harness, kind: RoundKind): RoundSummary {
  const round = start(harness, kind);
  const finished = harness.services.finishRound(round.id, firstPassAnswers(round));
  if (!finished.ok) throw new Error(finished.error.code);
  return finished.value;
}

describe("the records", () => {
  it("start from nothing mastered, one day in a row, and the placement's totals", () => {
    const harness = setUp();
    play(harness, "placement");
    const records = harness.services.records();
    expect(
      records.reach.topics.map((topic) => [topic.id, topic.count, topic.added]),
    ).toStrictEqual([
      ["work", 0, 0],
      ["daily", 0, 0],
    ]);
    expect(records.breakdown).toStrictEqual([
      {
        id: "work",
        ja: "仕事",
        subtopics: [
          { id: "meetings", ja: "会議", count: 0 },
          { id: "requests", ja: "依頼", count: 0 },
        ],
      },
      { id: "daily", ja: "日常", subtopics: [{ id: "home", ja: "家", count: 0 }] },
    ]);
    expect(records.toeic).not.toBeNull();
    expect(records.streak).toStrictEqual({ current: 1, longest: 1 });
    expect(records.calendar).toHaveLength(12);
    expect(records.calendar.every((week) => week.length === 7)).toBe(true);
    expect(records.calendar.flat().filter((dot) => dot.state === "done")).toHaveLength(
      1,
    );
    expect(records).toMatchObject({
      said: 10,
      practicedDays: 1,
      points: 20,
      titles: [],
    });
  });

  it("count mastered cards by topic and subtopic, the same numbers the summary gave", () => {
    const harness = setUp();
    play(harness, "placement");
    harness.setTime(2026, 9, 24, 9);
    const summary = play(harness, "today");
    const records = harness.services.records();
    expect(records.reach.topics.map((topic) => topic.count)).toStrictEqual(
      summary.reach.topics.map((topic) => topic.count),
    );
    expect(records.reach.topics.every((topic) => topic.added === 0)).toBe(true);
    for (const topic of records.breakdown) {
      const total = topic.subtopics.reduce((sum, subtopic) => sum + subtopic.count, 0);
      expect(total).toBe(
        records.reach.topics.find((reach) => reach.id === topic.id)?.count,
      );
    }
    expect(records.streak).toStrictEqual({ current: 2, longest: 2 });
    expect(records.points).toBe(summary.points.total);
  });

  it("group the titles taken, the streak first and then the topics in taxonomy order", () => {
    const harness = setUp();
    const round = start(harness, "placement");
    for (const key of [
      "reach:daily:10",
      "streak:14",
      "reach:work:25",
      "streak:7",
      "reach:work:10",
    ]) {
      harness.store.awardTitle(key, 1, round.id);
    }
    expect(harness.services.records().titles).toStrictEqual([
      { kind: "streak", values: [7, 14] },
      { kind: "reach", topic: "work", ja: "仕事", values: [10, 25] },
      { kind: "reach", topic: "daily", ja: "日常", values: [10] },
    ]);
  });

  it("show a broken run as 0, which the screen words as day 1 from today", () => {
    const harness = setUp();
    play(harness, "placement");
    harness.setTime(2026, 9, 27, 9);
    expect(harness.services.records().streak).toStrictEqual({ current: 0, longest: 1 });
  });
});

describe("the settings page", () => {
  it("carries the saved settings, every topic to choose from, and the difficulty", () => {
    const harness = setUp();
    expect(harness.services.settingsPage()).toMatchObject({
      settings: { topics: ["work", "daily"], focus: [], dailySize: 10, sound: true },
      topics: TAXONOMY.topics.map((topic) => ({ id: topic.id, ja: topic.ja })),
      toeic: null,
    });
    play(harness, "placement");
    expect(harness.services.settingsPage().toeic).not.toBeNull();
  });
});
