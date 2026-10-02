import { describe, expect, it } from "vitest";

import {
  drillReducer,
  type DrillState,
  type GradeKeyTrio,
  initDrill,
  keyAction,
  type KeyPress,
} from "@instant-composition/web";

const DEFAULT: GradeKeyTrio = { ok: "ArrowRight", ng: "ArrowLeft", hard: "Digit2" };
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
  s: "KeyS",
  "1": "Digit1",
  "2": "Digit2",
  "3": "Digit3",
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
    isNew: {},
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
  grade: "good",
  at: 2000,
  wall: 2000,
  key: false,
});
const paused = drillReducer(front, { type: "pause", at: 500 });

const grade = (given: "again" | "hard" | "good") => ({ type: "grade", grade: given });

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
    ["ArrowLeft", grade("again")],
    ["1", grade("again")],
    ["j", grade("again")],
    ["J", grade("again")],
    ["d", grade("again")],
    ["D", grade("again")],
    ["2", grade("hard")],
    ["ArrowRight", grade("good")],
    ["3", grade("good")],
    ["k", grade("good")],
    ["K", grade("good")],
    ["f", grade("good")],
    ["F", grade("good")],
    ["ArrowDown", { type: "scroll", direction: 1 }],
    ["ArrowUp", { type: "scroll", direction: -1 }],
    ["Escape", { type: "pause" }],
    [" ", undefined],
    ["Enter", undefined],
    ["s", undefined],
  ])("on a flipped back maps %j", (key, action) => {
    expect(keyAction(back, on(key), DEFAULT)).toStrictEqual(action);
  });

  it.each([
    ["ArrowLeft", grade("again")],
    ["2", grade("hard")],
    ["k", grade("good")],
    ["ArrowDown", { type: "scroll", direction: 1 }],
    ["Escape", { type: "pause" }],
    [" ", undefined],
    ["Enter", undefined],
  ])("on a timed-out back maps %j, Space and Enter doing nothing", (key, action) => {
    expect(keyAction(timedOut, on(key), DEFAULT)).toStrictEqual(action);
  });

  it("grades by the default trio's digits whatever character the layout types", () => {
    expect(keyAction(back, { key: "&", code: "Digit1" }, DEFAULT)).toStrictEqual(
      grade("again"),
    );
    expect(keyAction(back, { key: "é", code: "Digit2" }, DEFAULT)).toStrictEqual(
      grade("hard"),
    );
  });

  it("only pauses during the feedback", () => {
    expect(keyAction(feedback, on("Escape"), DEFAULT)).toStrictEqual({ type: "pause" });
    expect(keyAction(feedback, on("k"), DEFAULT)).toBeUndefined();
    expect(keyAction(feedback, on("2"), DEFAULT)).toBeUndefined();
  });

  it("only resumes on Escape while paused, leaving other keys to the dialog", () => {
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

  describe("with a trio the learner chose", () => {
    const CHOSEN: GradeKeyTrio = { ok: "KeyL", ng: "KeyA", hard: "KeyS" };

    it.each([
      [on("l"), grade("good")],
      [on("a"), grade("again")],
      [on("s"), grade("hard")],
      [{ key: "L", code: "KeyL" }, grade("good")],
      [{ key: "Process", code: "KeyL" }, grade("good")],
      [{ key: "l", code: "KeyO" }, undefined],
      [on("ArrowRight"), undefined],
      [on("ArrowLeft"), undefined],
      [on("1"), undefined],
      [on("2"), undefined],
      [on("3"), undefined],
      [on("k"), undefined],
      [on("j"), undefined],
      [on("f"), undefined],
      [on("d"), undefined],
      [on("ArrowDown"), { type: "scroll", direction: 1 }],
    ])("on a flipped back maps %j by its code alone", (press, action) => {
      expect(keyAction(back, press, CHOSEN)).toStrictEqual(action);
    });

    it("grades a timed-out back with the chosen keys, not the default", () => {
      expect(keyAction(timedOut, on("l"), CHOSEN)).toStrictEqual(grade("good"));
      expect(keyAction(timedOut, on("s"), CHOSEN)).toStrictEqual(grade("hard"));
      expect(keyAction(timedOut, on("ArrowRight"), CHOSEN)).toBeUndefined();
      expect(keyAction(timedOut, on("k"), CHOSEN)).toBeUndefined();
    });

    it("grades with ↑ or ↓ chosen as a grade key, and scrolls with the other", () => {
      const arrows: GradeKeyTrio = { ok: "ArrowUp", ng: "Digit1", hard: "Digit2" };
      expect(keyAction(back, on("ArrowUp"), arrows)).toStrictEqual(grade("good"));
      expect(keyAction(back, on("1"), arrows)).toStrictEqual(grade("again"));
      expect(keyAction(back, on("ArrowDown"), arrows)).toStrictEqual({
        type: "scroll",
        direction: 1,
      });
      const down: GradeKeyTrio = { ok: "KeyK", ng: "KeyJ", hard: "ArrowDown" };
      expect(keyAction(timedOut, on("ArrowDown"), down)).toStrictEqual(grade("hard"));
      expect(keyAction(timedOut, on("ArrowUp"), down)).toStrictEqual({
        type: "scroll",
        direction: -1,
      });
    });

    it("keeps Space, Enter, Esc and ? the drill's own", () => {
      expect(keyAction(front, on(" "), CHOSEN)).toStrictEqual({ type: "flip" });
      expect(keyAction(back, on("?"), CHOSEN)).toStrictEqual({ type: "pause" });
      expect(keyAction(back, on("Escape"), CHOSEN)).toStrictEqual({ type: "pause" });
      expect(keyAction(front, on("l"), CHOSEN)).toBeUndefined();
    });
  });
});
