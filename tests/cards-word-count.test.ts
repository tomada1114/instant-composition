import { describe, expect, it } from "vitest";

import { countWords as timerWords } from "@instant-composition/domain";

import { countJaChars, countWords as lintWords } from "../scripts/cards/text.mjs";

describe("a model answer's word count", () => {
  it.each([
    ["Can we push the meeting to next week?", 8],
    ["  I'll   send it.  ", 3],
    ["", 0],
    ["Wait — could you send it again?", 6],
    ["Salt & pepper, please.", 3],
    ["It costs 5 dollars.", 4],
    ["— & …", 0],
  ])("is the same for the linter and the timer: %j", (text, expected) => {
    expect(lintWords(text)).toBe(expected);
    expect(timerWords(text)).toBe(expected);
  });
});

describe("a prompt's character count", () => {
  it.each([
    ["会議を始めましょう。", 10],
    ["明日の会議、10 分遅れて始めてもいいですか？", 22],
    ["Slack で送って", 9],
    ["  ", 0],
    ["𠮷野家で", 4],
  ])("leaves whitespace out and counts code points: %j", (text, expected) => {
    expect(countJaChars(text)).toBe(expected);
  });
});
