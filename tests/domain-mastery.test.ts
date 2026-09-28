import { describe, expect, it } from "vitest";

import {
  nearestMilestone,
  reachBySubtopic,
  reachByTopic,
  resolvePlacement,
  ringProgress,
  TUNING,
} from "@instant-composition/domain";

import { makeAnswer } from "./domain-fixtures";

describe("where a mastered card is counted", () => {
  const answers = [
    makeAnswer({ cardId: "live", topic: "work", subtopic: "old" }),
    makeAnswer({ cardId: "gone", topic: "work", subtopic: "old" }),
    makeAnswer({ cardId: "lost", topic: "travel", subtopic: "airport" }),
  ];

  it("comes from the card, then its tombstone, then the answer's copy", () => {
    const where = resolvePlacement(
      new Map([["live", { topic: "daily", subtopic: "home" }]]),
      new Map([["gone", { topic: "tech", subtopic: "tools" }]]),
      answers,
    );
    expect(Object.fromEntries(where)).toStrictEqual({
      live: { topic: "daily", subtopic: "home" },
      gone: { topic: "tech", subtopic: "tools" },
      lost: { topic: "travel", subtopic: "airport" },
    });
  });

  it("adds up per topic and per subtopic, deleted cards included", () => {
    const where = resolvePlacement(new Map(), new Map(), answers);
    const ids = ["live", "gone", "lost"];
    expect(Object.fromEntries(reachByTopic(ids, where))).toStrictEqual({
      work: 2,
      travel: 1,
    });
    expect(Object.fromEntries(reachBySubtopic(ids, where))).toStrictEqual({
      "work/old": 2,
      "travel/airport": 1,
    });
  });
});

describe("milestone rings", () => {
  it.each([
    [0, 0, 10],
    [9, 0, 10],
    [10, 10, 25],
    [58, 50, 100],
    [101, 100, 200],
    [137, 100, 200],
    [300, 300, 400],
  ])("puts %p between milestones %p and %p", (count, from, to) => {
    expect(ringProgress(count, TUNING.reachMilestones)).toStrictEqual({
      from,
      to,
      done: count - from,
      span: to - from,
    });
  });

  it("names the chosen topic closest to its next milestone", () => {
    const reach = new Map([
      ["daily", 101],
      ["work", 137],
      ["tech", 58],
    ]);
    expect(nearestMilestone(reach, ["daily", "work", "tech"])).toStrictEqual({
      topic: "tech",
      remaining: 42,
    });
  });

  it("breaks a tie by topic order and counts a topic with nothing yet", () => {
    expect(nearestMilestone(new Map(), ["work", "daily"])).toStrictEqual({
      topic: "work",
      remaining: 10,
    });
  });
});
