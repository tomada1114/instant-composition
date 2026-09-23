import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeSkeleton } from "../src/components/home/home-skeleton";
import { TUNING } from "../src/core/tuning";

afterEach(() => {
  vi.useRealTimers();
});

describe("HomeSkeleton", () => {
  it("shows nothing at first, and the placeholder blocks only after the delay", () => {
    vi.useFakeTimers();
    const { container } = render(<HomeSkeleton />);
    const main = container.querySelector("main");
    expect(main?.childElementCount).toBe(0);
    act(() => {
      vi.advanceTimersByTime(TUNING.skeletonDelayMs - 1);
    });
    expect(main?.childElementCount).toBe(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(main?.childElementCount).toBeGreaterThan(0);
    expect(main).toHaveAttribute("aria-hidden", "true");
  });
});
