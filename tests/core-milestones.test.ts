import { describe, expect, it } from "vitest";

import {
  crossedMilestones,
  newTitles,
  nextMilestone,
  parseTitleKey,
  previousMilestone,
} from "../src/core/milestones";
import { TUNING } from "../src/core/tuning";

const STREAK = TUNING.streakMilestones;
const REACH = TUNING.reachMilestones;

describe("milestone series", () => {
  it.each([
    [0, 7],
    [7, 14],
    [364, 365],
    [365, 400],
    [400, 500],
  ])("puts the streak milestone after %p at %p", (count, next) => {
    expect(nextMilestone(count, STREAK)).toBe(next);
  });

  it.each([
    [6, 0],
    [7, 7],
    [380, 365],
    [420, 400],
  ])("puts the streak milestone at or below %p at %p", (count, previous) => {
    expect(previousMilestone(count, STREAK)).toBe(previous);
  });

  it("lists every milestone crossed between two counts", () => {
    expect(crossedMilestones(5, 15, STREAK)).toStrictEqual([7, 14]);
    expect(crossedMilestones(99, 101, REACH)).toStrictEqual([100]);
    expect(crossedMilestones(190, 310, REACH)).toStrictEqual([200, 300]);
    expect(crossedMilestones(14, 14, STREAK)).toStrictEqual([]);
  });
});

describe("titles earned by a round", () => {
  const base = {
    streakBefore: 13,
    streakAfter: 13,
    reachBefore: new Map<string, number>(),
    reachAfter: new Map<string, number>(),
    topicOrder: ["daily", "work", "tech"],
    awarded: new Set<string>(),
  };

  it("names a streak milestone reached", () => {
    expect(newTitles({ ...base, streakAfter: 14 })).toStrictEqual(["streak:14"]);
  });

  it("orders several titles streak first, then by topic order", () => {
    const titles = newTitles({
      ...base,
      streakAfter: 14,
      reachBefore: new Map([
        ["work", 24],
        ["daily", 99],
      ]),
      reachAfter: new Map([
        ["work", 26],
        ["daily", 101],
      ]),
    });
    expect(titles).toStrictEqual(["streak:14", "reach:daily:100", "reach:work:25"]);
  });

  it("never names a title a second time", () => {
    expect(
      newTitles({
        ...base,
        reachBefore: new Map([["daily", 9]]),
        reachAfter: new Map([["daily", 10]]),
        awarded: new Set(["reach:daily:10"]),
      }),
    ).toStrictEqual([]);
  });

  it("reads a title key back into its parts", () => {
    expect(parseTitleKey("streak:14")).toStrictEqual({ kind: "streak", value: 14 });
    expect(parseTitleKey("reach:daily:100")).toStrictEqual({
      kind: "reach",
      topic: "daily",
      value: 100,
    });
    expect(parseTitleKey("nonsense")).toBeUndefined();
  });
});
