import { describe, expect, it } from "vitest";

import { MAX_ROUND_ANSWERS } from "@instant-composition/contracts";
import {
  isGradeKey as isDomainGradeKey,
  TALK_TUNING,
  TUNING as DOMAIN_TUNING,
} from "@instant-composition/domain";
import {
  ANSWER_FIELD_MAX,
  isDefaultGradeKeys,
  isFast,
  isGradeKey,
  keyLabel,
  parseTitleKey,
  TUNING,
} from "@instant-composition/web";

// The web client imports no workspace package, so the rule values it shows or
// applies are copies; this is what keeps each copy equal to its source.

describe("the web client's tuning", () => {
  it("holds the practice rules' day boundary and fast share as the domain states them", () => {
    expect(TUNING.dayBoundaryHour).toBe(DOMAIN_TUNING.dayBoundaryHour);
    expect(TUNING.fastRatio).toBe(DOMAIN_TUNING.fastRatio);
  });

  it("offers the domain's daily limits and time limits and keeps its most focus subtopics", () => {
    expect(TUNING.newPerDay).toStrictEqual(DOMAIN_TUNING.newPerDay);
    expect(TUNING.reviewsPerDay).toStrictEqual(DOMAIN_TUNING.reviewsPerDay);
    expect(TUNING.limitSeconds).toStrictEqual(DOMAIN_TUNING.limitSeconds);
    expect(TUNING.maxFocus).toBe(DOMAIN_TUNING.maxFocus);
  });

  it("grades with the domain's default keys, and allows the grade keys the domain allows", () => {
    expect(TUNING.defaultGradeKeys).toStrictEqual(DOMAIN_TUNING.defaultGradeKeys);
    expect(TUNING.defaultHardKey).toBe(DOMAIN_TUNING.hardKeys[0]);
    const codes = [
      ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => `Key${letter}`),
      ..."0123456789".split("").map((digit) => `Digit${digit}`),
      ...["Up", "Down", "Left", "Right"].map((way) => `Arrow${way}`),
      ...["Space", "Enter", "Escape", "Slash", "Tab", "Numpad1", "F1", "ShiftLeft"],
      ...["Keya", "KeyAB", "Digit10", "ArrowUpLeft", "k", "→", " KeyA", ""],
    ];
    expect(codes.map((code) => [code, isGradeKey(code)])).toStrictEqual(
      codes.map((code) => [code, isDomainGradeKey(code)]),
    );
  });

  it("sends at most the contract's answers in one request", () => {
    expect(TUNING.maxRoundAnswers).toBe(MAX_ROUND_ANSWERS);
  });

  it("runs a talk for the domain's turns, each field taking the domain's most characters", () => {
    expect(TUNING.talkTurns).toBe(TALK_TUNING.turns);
    expect(ANSWER_FIELD_MAX).toBe(TALK_TUNING.maxChars);
  });

  it("calls a flip fast up to half the pace, and not past it", () => {
    expect(isFast(5_000, 10_000)).toBe(true);
    expect(isFast(5_001, 10_000)).toBe(false);
  });
});

describe("the grade keys as the client shows them", () => {
  it.each([
    ["ArrowUp", "↑"],
    ["ArrowDown", "↓"],
    ["ArrowLeft", "←"],
    ["ArrowRight", "→"],
    ["Digit0", "0"],
    ["KeyQ", "Q"],
  ])("labels %s as %s", (code, label) => {
    expect(keyLabel(code)).toBe(label);
  });

  it("tells the default trio from one the learner chose, even one with an arrow in it", () => {
    const keys = { ok: "ArrowRight", ng: "ArrowLeft", hard: "Digit2" };
    expect(isDefaultGradeKeys(keys)).toBe(true);
    expect(isDefaultGradeKeys({ ...keys, ok: "ArrowLeft", ng: "ArrowRight" })).toBe(
      false,
    );
    expect(isDefaultGradeKeys({ ...keys, ng: "KeyJ" })).toBe(false);
    expect(isDefaultGradeKeys({ ...keys, hard: "ArrowDown" })).toBe(false);
  });
});

describe("parseTitleKey", () => {
  it.each([
    ["streak:30", { kind: "streak", value: 30 }],
    ["reach:work:100", { kind: "reach", topic: "work", value: 100 }],
  ] as const)("reads %s", (key, title) => {
    expect(parseTitleKey(key)).toStrictEqual(title);
  });

  it.each(["streak:", "streak:x", "reach:work", "reach::5", "grade:1", ""])(
    "leaves out %j, a key this client does not know",
    (key) => {
      expect(parseTitleKey(key)).toBeUndefined();
    },
  );
});
