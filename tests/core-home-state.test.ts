import { describe, expect, it } from "vitest";

import { homeState, type HomeInput } from "../src/core/home-state";

const T = "2026-09-23";

function run(last: string, n: number): string[] {
  const end = new Date(`${last}T00:00:00Z`).getTime();
  return Array.from({ length: n }, (_, index) =>
    new Date(end - index * 86_400_000).toISOString().slice(0, 10),
  );
}

function input(overrides: Partial<HomeInput> = {}): HomeInput {
  return {
    hasSettings: true,
    hasLevel: true,
    today: T,
    completed: new Set(run("2026-09-22", 12)),
    portions: new Map(),
    activeRound: undefined,
    available: 40,
    ...overrides,
  };
}

describe("the start screen state", () => {
  it("sends a first visit to choose topics", () => {
    expect(homeState(input({ hasSettings: false }))).toStrictEqual({
      kind: "onboarding",
    });
  });

  it("sends a learner with no level yet to placement", () => {
    expect(homeState(input({ hasLevel: false }))).toStrictEqual({ kind: "placement" });
  });

  it("is ready with yesterday's run when yesterday was completed", () => {
    expect(homeState(input())).toStrictEqual({
      kind: "ready",
      streak: { kind: "count", value: 12, yesterdayGap: false },
    });
  });

  it("is ready from day one, with the longest run, after two open days", () => {
    expect(
      homeState(input({ completed: new Set(run("2026-09-20", 21)) })),
    ).toStrictEqual({
      kind: "ready",
      streak: { kind: "restart", longest: 21 },
    });
  });

  it("offers to make up yesterday when only yesterday is open", () => {
    expect(
      homeState(input({ completed: new Set(run("2026-09-21", 12)) })),
    ).toStrictEqual({
      kind: "recover-offer",
      streak: { kind: "count", value: 12, yesterdayGap: true },
    });
  });

  it("resumes today's portion when a round of it is under way", () => {
    expect(
      homeState(
        input({
          activeRound: { kind: "today", portionDay: T },
          portions: new Map([[T, { target: 10, progress: 4 }]]),
        }),
      ),
    ).toStrictEqual({
      kind: "in-progress",
      portion: "today",
      progress: 4,
      target: 10,
      resumeKind: "today",
      streak: { kind: "count", value: 12, yesterdayGap: false },
    });
  });

  it("resumes today's portion after a placement that covered only part of it", () => {
    expect(
      homeState(input({ portions: new Map([[T, { target: 20, progress: 10 }]]) })),
    ).toMatchObject({
      kind: "in-progress",
      progress: 10,
      target: 20,
      resumeKind: "today",
    });
  });

  it("resumes an interrupted re-placement that counts toward today", () => {
    expect(
      homeState(
        input({
          activeRound: { kind: "placement", portionDay: T },
          portions: new Map([[T, { target: 10, progress: 3 }]]),
        }),
      ),
    ).toMatchObject({ kind: "in-progress", resumeKind: "placement" });
  });

  it("shows the gap above yesterday's portion under way", () => {
    expect(
      homeState(
        input({
          completed: new Set(run("2026-09-21", 12)),
          activeRound: { kind: "yesterday", portionDay: "2026-09-22" },
          portions: new Map([["2026-09-22", { target: 10, progress: 4 }]]),
        }),
      ),
    ).toStrictEqual({
      kind: "in-progress",
      portion: "yesterday",
      progress: 4,
      target: 10,
      resumeKind: "yesterday",
      streak: { kind: "count", value: 12, yesterdayGap: true },
    });
  });

  it("does not resume a part of yesterday that can no longer be made up", () => {
    expect(
      homeState(
        input({
          completed: new Set(run("2026-09-20", 5)),
          portions: new Map([["2026-09-22", { target: 10, progress: 4 }]]),
        }),
      ),
    ).toMatchObject({ kind: "ready" });
  });

  it("resumes a part of yesterday while it can still be made up", () => {
    expect(
      homeState(
        input({
          completed: new Set(run("2026-09-21", 5)),
          portions: new Map([["2026-09-22", { target: 10, progress: 4 }]]),
        }),
      ),
    ).toMatchObject({
      kind: "in-progress",
      portion: "yesterday",
      resumeKind: "yesterday",
    });
  });

  it("shows day one above today's portion on a day that started over", () => {
    expect(
      homeState(
        input({
          completed: new Set([...run("2026-09-21", 3), ...run("2026-09-10", 20)]),
          activeRound: { kind: "today", portionDay: T },
          portions: new Map([[T, { target: 10, progress: 2 }]]),
        }),
      ),
    ).toMatchObject({ kind: "in-progress", streak: { kind: "restart", longest: 20 } });
  });

  it("is done once today is completed, an extra round in progress or not", () => {
    expect(
      homeState(
        input({
          completed: new Set(run(T, 13)),
          activeRound: { kind: "extra", portionDay: null },
        }),
      ),
    ).toStrictEqual({
      kind: "done",
      restoresTo: null,
      streak: { kind: "count", value: 13, yesterdayGap: false },
    });
  });

  it("is done with yesterday still to make up on a day that started over", () => {
    expect(
      homeState(input({ completed: new Set([T, ...run("2026-09-21", 12)]) })),
    ).toStrictEqual({
      kind: "done",
      restoresTo: 14,
      streak: { kind: "count", value: 1, yesterdayGap: true },
    });
  });

  it("reports too few cards when fewer than five can be dealt", () => {
    expect(homeState(input({ available: 4 }))).toStrictEqual({
      kind: "not-enough",
      available: 4,
      streak: { kind: "count", value: 12, yesterdayGap: false },
    });
  });
});
