import { afterEach, describe, expect, it } from "vitest";

import type { RoundKind } from "../src/core/types";
import type { RoundPayload, RoundSummary } from "../src/core/views";
import { removeContentRoots } from "./cards-fixture";
import { firstPassAnswers, makeHarness, type Harness } from "./services-harness";

// F10 (making up yesterday) and F5 (a round across the 4 a.m. cut-off),
// driven through the services the way the screens drive them.

const harnesses: Harness[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
  removeContentRoots();
});

function start(harness: Harness, kind: RoundKind): RoundPayload {
  const result = harness.services.startRound(kind);
  if (!result.ok) throw new Error(`expected a round, got ${result.error.code}`);
  return result.value;
}

function finish(harness: Harness, round: RoundPayload): RoundSummary {
  const finished = harness.services.finishRound(round.id, firstPassAnswers(round));
  if (!finished.ok) throw new Error(finished.error.code);
  return finished.value;
}

/** Placed and done on Wednesday 23rd, Thursday 24th left open, now Friday 25th 9:00. */
function yesterdayOpen(): Harness {
  const harness = makeHarness();
  harnesses.push(harness);
  harness.services.updateSettings({ topics: ["work", "daily"] });
  finish(harness, start(harness, "placement"));
  harness.setTime(2026, 9, 25, 9);
  return harness;
}

describe("making up yesterday (F10)", () => {
  it("goes W3e, yesterday's round, W9y, then today's portion, keeping the run", () => {
    const harness = yesterdayOpen();
    expect(harness.services.home().state).toStrictEqual({
      kind: "recover-offer",
      streak: { kind: "count", value: 1, yesterdayGap: true },
    });

    const yesterday = start(harness, "yesterday");
    expect(yesterday.portionDay).toBe("2026-09-24");
    const made = finish(harness, yesterday);
    expect(made).toMatchObject({
      yesterday: true,
      todayOpen: true,
      filled: "2026-09-24",
      streak: { value: 2, changed: true },
      portionCompleted: true,
    });
    expect(harness.services.home().state).toMatchObject({
      kind: "ready",
      streak: { kind: "count", value: 2, yesterdayGap: false },
    });

    const today = finish(harness, start(harness, "today"));
    expect(today).toMatchObject({ filled: "2026-09-25", streak: { value: 3 } });
    expect(harness.services.home().state).toMatchObject({
      kind: "done",
      restoresTo: null,
    });
  });

  it("restores the run from the done screen when today came first", () => {
    const harness = yesterdayOpen();
    finish(harness, start(harness, "today"));
    expect(harness.services.home().state).toMatchObject({
      kind: "done",
      restoresTo: 3,
      streak: { kind: "count", value: 1, yesterdayGap: true },
    });
    const made = finish(harness, start(harness, "yesterday"));
    expect(made).toMatchObject({
      yesterday: true,
      todayOpen: false,
      streak: { value: 3 },
    });
    expect(harness.services.home().state).toMatchObject({
      kind: "done",
      restoresTo: null,
      streak: { kind: "count", value: 3 },
    });
  });

  it("closes yesterday at 4 a.m.: the open day is missed and the run starts over", () => {
    const harness = yesterdayOpen();
    const yesterday = start(harness, "yesterday");
    for (const answer of firstPassAnswers(yesterday).slice(0, 3))
      harness.services.recordAnswer(answer);
    harness.setTime(2026, 9, 26, 4, 1);
    expect(harness.services.startRound("yesterday")).toMatchObject({
      ok: false,
      error: { code: "ERR_ROUND_CLOSED" },
    });
    expect(harness.services.home().state).toStrictEqual({
      kind: "ready",
      streak: { kind: "restart", longest: 1 },
    });
    expect(
      harness.services
        .records()
        .calendar.flat()
        .filter((dot) => dot.day === "2026-09-24"),
    ).toStrictEqual([{ day: "2026-09-24", state: "missed" }]);
  });

  it("still offers yesterday until the stroke of 4 a.m.", () => {
    const harness = yesterdayOpen();
    harness.setTime(2026, 9, 26, 3, 59);
    expect(harness.services.home().state.kind).toBe("recover-offer");
    expect(start(harness, "yesterday").portionDay).toBe("2026-09-24");
  });
});

describe("a round across the cut-off (F5)", () => {
  it("belongs to the day it started, even when finished after 4 a.m.", () => {
    const harness = yesterdayOpen();
    harness.setTime(2026, 9, 26, 3, 50);
    const late = start(harness, "yesterday");
    expect(late).toMatchObject({ day: "2026-09-25", portionDay: "2026-09-24" });
    harness.setTime(2026, 9, 26, 4, 10);
    const summary = finish(harness, late);
    expect(summary).toMatchObject({
      day: "2026-09-25",
      filled: "2026-09-24",
      portionCompleted: true,
    });
    expect(harness.store.completedDays().has("2026-09-24")).toBe(true);
  });

  it("counts a day's portion finished after midnight toward that day", () => {
    const harness = yesterdayOpen();
    harness.setTime(2026, 9, 25, 23, 50);
    const today = start(harness, "today");
    harness.setTime(2026, 9, 26, 0, 20);
    expect(finish(harness, today)).toMatchObject({
      day: "2026-09-25",
      filled: "2026-09-25",
    });
  });
});
