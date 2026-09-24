import { describe, expect, it } from "vitest";

import { countWords as timerWords } from "@instant-composition/domain";

import { countWords as lintWords } from "../scripts/cards/text.mjs";

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
