import { describe, expect, it } from "vitest";
import { testWorkers } from "../scripts/lib/test-workers.mjs";

describe("local test worker budget", () => {
  it("retains the runner default unless explicitly configured", () => {
    expect(testWorkers(undefined)).toBeUndefined();
  });
  it.each([1, 4])(
    "accepts an explicit budget of %i without changing test selection",
    (workers) => {
      expect(testWorkers(String(workers))).toBe(workers);
    },
  );
  it.each(["", "0", "-1", "1.5", "NaN", "1worker", "9007199254740992"])(
    "fails configuration on invalid budget %s",
    (value) => {
      expect(() => testWorkers(value)).toThrow(RangeError);
    },
  );
});
