import { describe, expect, it, vi } from "vitest";

import { playMotion, prefersReducedMotion } from "../src/components/drill/motion";

function element() {
  const calls: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = [];
  return {
    calls,
    animate: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      calls.push({ keyframes, options });
      return undefined;
    },
  };
}

function stubReducedMotion(matches: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)" && matches,
  }));
}

describe("prefersReducedMotion", () => {
  it("reads the operating system's setting", () => {
    stubReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    stubReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("assumes full motion where there is no matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("playMotion", () => {
  it("rises a back 8px into place over 180 ms, easing out", () => {
    stubReducedMotion(false);
    const el = element();
    playMotion(el, "rise");
    expect(el.calls).toStrictEqual([
      {
        keyframes: [
          { opacity: 0, transform: "translateY(8px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        options: { duration: 180, easing: "ease-out" },
      },
    ]);
  });

  it.each([
    ["fade", 120],
    ["pulse", 120],
    ["chip", 320],
  ] as const)("plays %s over %i ms", (name, duration) => {
    stubReducedMotion(false);
    const el = element();
    playMotion(el, name);
    expect(el.calls[0]?.options.duration).toBe(duration);
  });

  it("plays nothing under reduced motion", () => {
    stubReducedMotion(true);
    const el = element();
    playMotion(el, "rise");
    expect(el.calls).toStrictEqual([]);
  });

  it("does nothing without an element or without the Web Animations API", () => {
    stubReducedMotion(false);
    expect(() => {
      playMotion(null, "fade");
      playMotion({}, "fade");
    }).not.toThrow();
  });
});
