import { describe, expect, it } from "vitest";

import {
  masteredCards,
  nearestMilestone,
  reachBySubtopic,
  reachByTopic,
  resolvePlacement,
  ringProgress,
  TUNING,
} from "@instant-composition/domain";

import { makeAnswer } from "./domain-fixtures";

describe("a card counts as mastered", () => {
  it("on its second correct first-pass answer on a different day", () => {
    const mastered = masteredCards([
      makeAnswer({ day: "2026-09-20", answeredAt: 1, roundId: "a" }),
      makeAnswer({ day: "2026-09-22", answeredAt: 2, roundId: "b" }),
    ]);
    expect(mastered.get("c1")).toStrictEqual({
      cardId: "c1",
      day: "2026-09-22",
      roundId: "b",
    });
  });

  it("not from two correct answers on the same day", () => {
    const mastered = masteredCards([
      makeAnswer({ answeredAt: 1, roundId: "a" }),
      makeAnswer({ answeredAt: 2, roundId: "b" }),
    ]);
    expect(mastered.size).toBe(0);
  });

  it("not from a retry", () => {
    const mastered = masteredCards([
      makeAnswer({ day: "2026-09-20", answeredAt: 1 }),
      makeAnswer({ day: "2026-09-22", answeredAt: 2, pass: "retry" }),
    ]);
    expect(mastered.size).toBe(0);
  });

  it("not from a timeout or a miss, which leave earlier days standing", () => {
    const mastered = masteredCards([
      makeAnswer({ day: "2026-09-18", answeredAt: 1 }),
      makeAnswer({ day: "2026-09-19", answeredAt: 2, result: "timeout" }),
      makeAnswer({ day: "2026-09-20", answeredAt: 3, result: "ng" }),
      makeAnswer({ day: "2026-09-21", answeredAt: 4, roundId: "late" }),
    ]);
    expect(mastered.get("c1")?.day).toBe("2026-09-21");
  });

  it("once, at the first time it qualifies", () => {
    const mastered = masteredCards([
      makeAnswer({ day: "2026-09-18", answeredAt: 1 }),
      makeAnswer({ day: "2026-09-19", answeredAt: 2, roundId: "first" }),
      makeAnswer({ day: "2026-09-20", answeredAt: 3, roundId: "again" }),
    ]);
    expect(mastered.get("c1")?.roundId).toBe("first");
  });
});

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
