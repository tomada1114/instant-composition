import { afterEach, describe, expect, it } from "vitest";

import type { RoundKind } from "../src/core/types";
import type { RoundPayload } from "../src/core/views";
import { removeContentRoots } from "./cards-fixture";
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

function placed(harness: Harness): void {
  const round = start(harness, "placement");
  const finished = harness.services.finishRound(round.id, firstPassAnswers(round));
  if (!finished.ok) throw new Error(finished.error.code);
}

describe("saving the settings", () => {
  it("never lets the last topic go", () => {
    const harness = setUp();
    expect(harness.services.updateSettings({ topics: ["work"] }).ok).toBe(true);
    expect(harness.services.updateSettings({ topics: [] })).toStrictEqual({
      ok: false,
      error: { code: "ERR_BAD_REQUEST" },
    });
    expect(harness.services.settingsPage().settings.topics).toStrictEqual(["work"]);
  });

  it("keeps at most two focus subtopics", () => {
    const harness = setUp();
    const two = [
      { topic: "work", subtopic: "meetings" },
      { topic: "work", subtopic: "requests" },
    ];
    expect(harness.services.updateSettings({ focus: two }).ok).toBe(true);
    expect(
      harness.services.updateSettings({
        focus: [...two, { topic: "daily", subtopic: "home" }],
      }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_BAD_REQUEST" } });
  });

  it("drops a removed topic's focus with it, and says which", () => {
    const harness = setUp();
    harness.services.updateSettings({
      focus: [
        { topic: "work", subtopic: "meetings" },
        { topic: "daily", subtopic: "home" },
      ],
    });
    expect(harness.services.updateSettings({ topics: ["daily"] })).toMatchObject({
      ok: true,
      value: {
        settings: { topics: ["daily"], focus: [{ topic: "daily", subtopic: "home" }] },
        removedFocus: [{ topic: "work", subtopic: "meetings" }],
      },
    });
  });

  it("keeps the topics in the taxonomy's order whatever order they come in", () => {
    const harness = setUp();
    harness.services.updateSettings({ topics: ["daily", "work"] });
    expect(harness.services.settingsPage().settings.topics).toStrictEqual([
      "work",
      "daily",
    ]);
  });
});

describe("measuring the difficulty again", () => {
  it("counts toward today's portion when today has not started", () => {
    const harness = setUp();
    placed(harness);
    harness.setTime(2026, 9, 24, 9);
    const round = start(harness, "placement");
    expect(round.portionDay).toBe("2026-09-24");
    harness.services.finishRound(round.id, firstPassAnswers(round));
    expect(harness.services.home().state.kind).toBe("done");
  });

  it("is an extra round once today's portion is under way, leaving it as it was", () => {
    const harness = setUp();
    placed(harness);
    harness.setTime(2026, 9, 24, 9);
    const today = start(harness, "today");
    for (const answer of firstPassAnswers(today).slice(0, 3))
      harness.services.recordAnswer(answer);
    const again = start(harness, "placement");
    expect(again.portionDay).toBeNull();
    harness.services.finishRound(again.id, firstPassAnswers(again));
    expect(harness.services.home().state).toMatchObject({
      kind: "in-progress",
      progress: 3,
    });
  });

  it("is an extra round once today's portion is done", () => {
    const harness = setUp();
    placed(harness);
    expect(start(harness, "placement").portionDay).toBeNull();
  });
});
