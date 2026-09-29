import { describe, expect, it } from "vitest";

import {
  drillReducer,
  type DrillState,
  type GradeKeys,
  initDrill,
  keyAction,
  type KeyPress,
} from "@instant-composition/web";

const DEFAULT: GradeKeys = { ok: "ArrowRight", ng: "ArrowLeft" };
const CODES: Readonly<Record<string, string>> = {
  " ": "Space",
  "?": "Slash",
  j: "KeyJ",
  J: "KeyJ",
  k: "KeyK",
  K: "KeyK",
  d: "KeyD",
  D: "KeyD",
  f: "KeyF",
  F: "KeyF",
  l: "KeyL",
  a: "KeyA",
  "1": "Digit1",
};

/** A press of `key` on a US layout, the code a browser would give it. */
function on(key: string): KeyPress {
  return { key, code: CODES[key] ?? key };
}

function state(intro = false): DrillState {
  return initDrill({
    roundId: "r",
    deck: ["c1", "c2"],
    limits: { c1: 7000, c2: 7000 },
    paces: { c1: 7000, c2: 7000 },
    answered: [],
    retries: true,
    intro,
  });
}

const front = drillReducer(state(), { type: "shown", at: 0 });
const back = drillReducer(front, { type: "flip", at: 1000, wall: 1000 });
const timedOut = drillReducer(front, { type: "tick", at: 7000, wall: 7000 });
const feedback = drillReducer(back, {
  type: "grade",
  result: "ok",
  at: 2000,
  wall: 2000,
  key: false,
});
const paused = drillReducer(front, { type: "pause", at: 500 });

describe("keyAction", () => {
  it.each([
    [" ", { type: "start" }],
    ["Enter", { type: "start" }],
    ["Escape", undefined],
  ])("on the explanation maps %j", (key, action) => {
    expect(keyAction(state(true), on(key), DEFAULT)).toStrictEqual(action);
  });

  it.each([
    [" ", { type: "flip" }],
    ["Enter", { type: "flip" }],
    ["Escape", { type: "pause" }],
    ["?", { type: "pause" }],
    ["ArrowRight", undefined],
  ])("on a front maps %j", (key, action) => {
    expect(keyAction(front, on(key), DEFAULT)).toStrictEqual(action);
  });

  it.each([
    ["ArrowRight", { type: "grade", result: "ok" }],
    ["k", { type: "grade", result: "ok" }],
    ["K", { type: "grade", result: "ok" }],
    ["f", { type: "grade", result: "ok" }],
    ["F", { type: "grade", result: "ok" }],
    ["ArrowLeft", { type: "grade", result: "ng" }],
    ["j", { type: "grade", result: "ng" }],
    ["J", { type: "grade", result: "ng" }],
    ["d", { type: "grade", result: "ng" }],
    ["D", { type: "grade", result: "ng" }],
    ["ArrowDown", { type: "scroll", direction: 1 }],
    ["ArrowUp", { type: "scroll", direction: -1 }],
    ["Escape", { type: "pause" }],
    [" ", undefined],
    ["Enter", undefined],
  ])("on a flipped back maps %j", (key, action) => {
    expect(keyAction(back, on(key), DEFAULT)).toStrictEqual(action);
  });

  it.each([
    [" ", { type: "next" }],
    ["Enter", { type: "next" }],
    ["k", { type: "next" }],
    ["K", { type: "next" }],
    ["f", { type: "next" }],
    ["F", { type: "next" }],
    ["ArrowRight", { type: "next" }],
    ["ArrowLeft", undefined],
    ["j", undefined],
    ["J", undefined],
    ["d", undefined],
    ["D", undefined],
    ["ArrowDown", { type: "scroll", direction: 1 }],
    ["Escape", { type: "pause" }],
  ])("on a timed-out back maps %j", (key, action) => {
    expect(keyAction(timedOut, on(key), DEFAULT)).toStrictEqual(action);
  });

  it("only pauses during the feedback", () => {
    expect(keyAction(feedback, on("Escape"), DEFAULT)).toStrictEqual({ type: "pause" });
    expect(keyAction(feedback, on("k"), DEFAULT)).toBeUndefined();
  });

  it("only resumes on Escape while paused, leaving other keys to the sheet", () => {
    expect(keyAction(paused, on("Escape"), DEFAULT)).toStrictEqual({ type: "resume" });
    expect(keyAction(paused, on(" "), DEFAULT)).toBeUndefined();
    expect(keyAction(paused, on("Enter"), DEFAULT)).toBeUndefined();
    expect(keyAction(paused, on("?"), DEFAULT)).toBeUndefined();
  });

  it("does nothing once the round is finishing", () => {
    const finishing: DrillState = { ...front, phase: { kind: "finishing" } };
    expect(keyAction(finishing, on(" "), DEFAULT)).toBeUndefined();
    expect(keyAction(finishing, on("Escape"), DEFAULT)).toBeUndefined();
  });

  describe("with a pair the learner chose", () => {
    const CHOSEN: GradeKeys = { ok: "KeyL", ng: "KeyA" };

    it.each([
      [on("l"), { type: "grade", result: "ok" }],
      [on("a"), { type: "grade", result: "ng" }],
      [
        { key: "L", code: "KeyL" },
        { type: "grade", result: "ok" },
      ],
      [
        { key: "Process", code: "KeyL" },
        { type: "grade", result: "ok" },
      ],
      [{ key: "l", code: "KeyO" }, undefined],
      [on("ArrowRight"), undefined],
      [on("ArrowLeft"), undefined],
      [on("k"), undefined],
      [on("j"), undefined],
      [on("f"), undefined],
      [on("d"), undefined],
      [on("ArrowDown"), { type: "scroll", direction: 1 }],
    ])("on a flipped back maps %j by its code alone", (press, action) => {
      expect(keyAction(back, press, CHOSEN)).toStrictEqual(action);
    });

    it("moves on from a timed-out back with the chosen ○, not the default", () => {
      expect(keyAction(timedOut, on("l"), CHOSEN)).toStrictEqual({ type: "next" });
      expect(keyAction(timedOut, on("a"), CHOSEN)).toBeUndefined();
      expect(keyAction(timedOut, on("ArrowRight"), CHOSEN)).toBeUndefined();
      expect(keyAction(timedOut, on("k"), CHOSEN)).toBeUndefined();
    });

    it("grades with ↑ or ↓ chosen as a grade key, and scrolls with the other", () => {
      const arrows: GradeKeys = { ok: "ArrowUp", ng: "Digit1" };
      expect(keyAction(back, on("ArrowUp"), arrows)).toStrictEqual({
        type: "grade",
        result: "ok",
      });
      expect(keyAction(back, on("1"), arrows)).toStrictEqual({
        type: "grade",
        result: "ng",
      });
      expect(keyAction(back, on("ArrowDown"), arrows)).toStrictEqual({
        type: "scroll",
        direction: 1,
      });
      expect(keyAction(timedOut, on("ArrowUp"), arrows)).toStrictEqual({
        type: "next",
      });
      const down: GradeKeys = { ok: "KeyK", ng: "ArrowDown" };
      expect(keyAction(timedOut, on("ArrowDown"), down)).toBeUndefined();
    });

    it("keeps Space, Enter, Esc and ? the drill's own", () => {
      expect(keyAction(front, on(" "), CHOSEN)).toStrictEqual({ type: "flip" });
      expect(keyAction(back, on("?"), CHOSEN)).toStrictEqual({ type: "pause" });
      expect(keyAction(back, on("Escape"), CHOSEN)).toStrictEqual({ type: "pause" });
      expect(keyAction(front, on("l"), CHOSEN)).toBeUndefined();
    });
  });
});
