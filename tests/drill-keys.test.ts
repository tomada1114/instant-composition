import { describe, expect, it } from "vitest";

import { drillReducer } from "../src/core/drill-machine";
import { initDrill, type DrillState } from "../src/core/drill-state";
import { keyAction } from "../src/components/drill/keys";

function state(intro = false): DrillState {
  return initDrill({
    roundId: "r",
    deck: ["c1", "c2"],
    limits: { c1: 7000, c2: 7000 },
    answered: [],
    retries: true,
    intro,
  });
}

const front = drillReducer(state(), { type: "shown", at: 0 });
const back = drillReducer(front, { type: "flip", at: 1000 });
const timedOut = drillReducer(front, { type: "tick", at: 7000 });
const feedback = drillReducer(back, {
  type: "grade",
  result: "ok",
  at: 2000,
  key: false,
});
const paused = drillReducer(front, { type: "pause", at: 500 });

describe("keyAction", () => {
  it.each([
    [" ", { type: "start" }],
    ["Enter", { type: "start" }],
    ["Escape", undefined],
  ])("on the explanation maps %j", (key, action) => {
    expect(keyAction(state(true), key)).toStrictEqual(action);
  });

  it.each([
    [" ", { type: "flip" }],
    ["Enter", { type: "flip" }],
    ["Escape", { type: "pause" }],
    ["?", { type: "pause" }],
    ["ArrowRight", undefined],
  ])("on a front maps %j", (key, action) => {
    expect(keyAction(front, key)).toStrictEqual(action);
  });

  it.each([
    ["ArrowRight", { type: "grade", result: "ok" }],
    ["j", { type: "grade", result: "ok" }],
    ["J", { type: "grade", result: "ok" }],
    ["ArrowLeft", { type: "grade", result: "ng" }],
    ["f", { type: "grade", result: "ng" }],
    ["F", { type: "grade", result: "ng" }],
    ["ArrowDown", { type: "scroll", direction: 1 }],
    ["ArrowUp", { type: "scroll", direction: -1 }],
    ["Escape", { type: "pause" }],
    [" ", undefined],
    ["Enter", undefined],
  ])("on a flipped back maps %j", (key, action) => {
    expect(keyAction(back, key)).toStrictEqual(action);
  });

  it.each([
    [" ", { type: "next" }],
    ["Enter", { type: "next" }],
    ["ArrowRight", { type: "next" }],
    ["j", { type: "next" }],
    ["ArrowLeft", undefined],
    ["ArrowDown", { type: "scroll", direction: 1 }],
    ["Escape", { type: "pause" }],
  ])("on a timed-out back maps %j", (key, action) => {
    expect(keyAction(timedOut, key)).toStrictEqual(action);
  });

  it("only pauses during the feedback", () => {
    expect(keyAction(feedback, "Escape")).toStrictEqual({ type: "pause" });
    expect(keyAction(feedback, "ArrowRight")).toBeUndefined();
  });

  it("only resumes on Escape while paused, leaving other keys to the sheet", () => {
    expect(keyAction(paused, "Escape")).toStrictEqual({ type: "resume" });
    expect(keyAction(paused, " ")).toBeUndefined();
    expect(keyAction(paused, "Enter")).toBeUndefined();
    expect(keyAction(paused, "?")).toBeUndefined();
  });

  it("does nothing once the round is finishing", () => {
    const finishing: DrillState = { ...front, phase: { kind: "finishing" } };
    expect(keyAction(finishing, " ")).toBeUndefined();
    expect(keyAction(finishing, "Escape")).toBeUndefined();
  });
});
