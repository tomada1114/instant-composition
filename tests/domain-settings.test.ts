import { describe, expect, it } from "vitest";

import {
  decideSettings,
  DEFAULT_SETTINGS,
  gradeKeysOf,
  isGradeKey,
  isGradeKeyPair,
  withDefaults,
  type SettingsPatch,
  type TopicInfo,
} from "@instant-composition/domain";

const TAXONOMY: TopicInfo[] = [
  {
    id: "work",
    name: "仕事",
    subtopics: [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ],
  },
  { id: "travel", name: "旅行", subtopics: [{ id: "c", name: "C" }] },
];

const CURRENT = {
  ...DEFAULT_SETTINGS,
  topics: ["work", "travel"],
  focus: [
    { topic: "work", subtopic: "a" },
    { topic: "travel", subtopic: "c" },
  ],
};

describe("decideSettings", () => {
  it("keeps every field the patch leaves out, and orders topics as the taxonomy does", () => {
    expect(
      decideSettings(CURRENT, { topics: ["travel", "work"], sound: false }, TAXONOMY),
    ).toStrictEqual({
      ok: true,
      value: { settings: { ...CURRENT, sound: false }, removedFocus: [] },
    });
  });

  it("removes a deselected topic's focus and reports it", () => {
    const decided = decideSettings(CURRENT, { topics: ["work"] }, TAXONOMY);
    expect(decided.ok && decided.value).toStrictEqual({
      settings: {
        ...CURRENT,
        topics: ["work"],
        focus: [{ topic: "work", subtopic: "a" }],
      },
      removedFocus: [{ topic: "travel", subtopic: "c" }],
    });
  });

  it("saves a chosen time limit, and keeps it through a patch that leaves it out", () => {
    const chosen = decideSettings(CURRENT, { limitSeconds: 45 }, TAXONOMY);
    expect(chosen.ok && chosen.value.settings).toStrictEqual({
      ...CURRENT,
      limitSeconds: 45,
    });
    const kept = decideSettings(
      { ...CURRENT, limitSeconds: 45 },
      { sound: false },
      TAXONOMY,
    );
    expect(kept.ok && kept.value.settings.limitSeconds).toBe(45);
  });

  it("leaves the limit unchosen until the learner chooses one, so the default stands in", () => {
    const decided = decideSettings(DEFAULT_SETTINGS, { topics: ["work"] }, TAXONOMY);
    expect(decided.ok && "limitSeconds" in decided.value.settings).toBe(false);
    expect(decided.ok && withDefaults(decided.value.settings).limitSeconds).toBe(30);
  });

  it("saves a chosen grade key pair, and keeps it through a patch that leaves it out", () => {
    const pair = { ok: "KeyL", ng: "KeyA" };
    const chosen = decideSettings(CURRENT, { gradeKeys: pair }, TAXONOMY);
    expect(chosen.ok && chosen.value.settings).toStrictEqual({
      ...CURRENT,
      gradeKeys: pair,
    });
    const kept = decideSettings(
      { ...CURRENT, gradeKeys: pair },
      { sound: false },
      TAXONOMY,
    );
    expect(kept.ok && kept.value.settings.gradeKeys).toStrictEqual(pair);
  });

  it("leaves the grade keys unchosen until the learner chooses them, so → and ← stand in", () => {
    const decided = decideSettings(DEFAULT_SETTINGS, { topics: ["work"] }, TAXONOMY);
    expect(decided.ok && "gradeKeys" in decided.value.settings).toBe(false);
    expect(decided.ok && withDefaults(decided.value.settings).gradeKeys).toStrictEqual({
      ok: "ArrowRight",
      ng: "ArrowLeft",
    });
    expect(gradeKeysOf(undefined)).toStrictEqual({ ok: "ArrowRight", ng: "ArrowLeft" });
  });

  it("saves a chosen answer mode, and keeps it through a patch that leaves it out", () => {
    const chosen = decideSettings(CURRENT, { answerMode: "typed" }, TAXONOMY);
    expect(chosen.ok && chosen.value.settings).toStrictEqual({
      ...CURRENT,
      answerMode: "typed",
    });
    const kept = decideSettings(
      { ...CURRENT, answerMode: "typed" },
      { sound: false },
      TAXONOMY,
    );
    expect(kept.ok && kept.value.settings.answerMode).toBe("typed");
  });

  it("leaves the answer mode unchosen until the learner chooses one, so spoken stands in", () => {
    const decided = decideSettings(DEFAULT_SETTINGS, { topics: ["work"] }, TAXONOMY);
    expect(decided.ok && "answerMode" in decided.value.settings).toBe(false);
    expect(decided.ok && withDefaults(decided.value.settings).answerMode).toBe(
      "spoken",
    );
    expect(withDefaults({ ...CURRENT, answerMode: "typed" }).answerMode).toBe("typed");
  });

  it("takes a focus named twice once", () => {
    const twice = { topic: "work", subtopic: "b" };
    const decided = decideSettings(CURRENT, { focus: [twice, twice] }, TAXONOMY);
    expect(decided.ok && decided.value.settings.focus).toStrictEqual([twice]);
  });

  it.each<[string, SettingsPatch]>([
    ["an unknown topic", { topics: ["cooking"] }],
    ["no topic at all", { topics: [] }],
    [
      "more focus than allowed",
      {
        focus: [
          { topic: "work", subtopic: "a" },
          { topic: "work", subtopic: "b" },
          { topic: "travel", subtopic: "c" },
        ],
      },
    ],
    ["an unknown focus", { focus: [{ topic: "work", subtopic: "z" }] }],
    [
      "a focus outside the chosen topics",
      { topics: ["work"], focus: [{ topic: "travel", subtopic: "c" }] },
    ],
    ["both grades on one key", { gradeKeys: { ok: "KeyJ", ng: "KeyJ" } }],
    ["a grade on a key outside the set", { gradeKeys: { ok: "Space", ng: "KeyJ" } }],
  ])("refuses %s", (_, patch) => {
    expect(decideSettings(CURRENT, patch, TAXONOMY)).toStrictEqual({
      ok: false,
      error: { code: "ERR_BAD_REQUEST" },
    });
  });
});

describe("the grade keys", () => {
  it.each([
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Digit0",
    "Digit9",
    "KeyA",
    "KeyZ",
  ])("takes %s", (code) => {
    expect(isGradeKey(code)).toBe(true);
  });

  it.each([
    ["the drill's flip", "Space"],
    ["the drill's other flip", "Enter"],
    ["the drill's pause", "Escape"],
    ["the key `?` is on", "Slash"],
    ["a keypad digit", "Numpad1"],
    ["a function key", "F1"],
    ["a modifier", "ShiftLeft"],
    ["a character rather than a code", "k"],
    ["a code with more after it", "KeyAB"],
    ["nothing", ""],
  ])("refuses %s (%j)", (_, code) => {
    expect(isGradeKey(code)).toBe(false);
  });

  it("takes a pair only when its two keys differ", () => {
    expect(isGradeKeyPair({ ok: "Digit1", ng: "Digit2" })).toBe(true);
    expect(isGradeKeyPair({ ok: "Digit1", ng: "Digit1" })).toBe(false);
    expect(isGradeKeyPair({ ok: "Digit1", ng: "Tab" })).toBe(false);
  });
});
