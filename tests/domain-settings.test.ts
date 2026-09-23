import { describe, expect, it } from "vitest";

import {
  decideSettings,
  DEFAULT_SETTINGS,
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
  ])("refuses %s", (_, patch) => {
    expect(decideSettings(CURRENT, patch, TAXONOMY)).toStrictEqual({
      ok: false,
      error: { code: "ERR_BAD_REQUEST" },
    });
  });
});
