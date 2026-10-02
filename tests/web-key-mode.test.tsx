import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KeyMode } from "@instant-composition/web";

const STORAGE_KEY = "instant-composition:keys";

function keysOn(): boolean {
  return document.documentElement.hasAttribute("data-keys");
}

afterEach(() => {
  document.documentElement.removeAttribute("data-keys");
  localStorage.clear();
  vi.unstubAllGlobals();
});

function stubDevice(touchOnly: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: touchOnly && query === "(pointer: coarse) and (hover: none)",
  }));
}

describe("KeyMode", () => {
  it("keeps key hints hidden until a key is pressed", () => {
    render(<KeyMode />);
    expect(keysOn()).toBe(false);
    fireEvent.keyDown(window, { key: " " });
    expect(keysOn()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it.each([
    ["Tab", {}],
    ["Shift", {}],
    ["r", { metaKey: true }],
  ])("does not count %s as using the keys", (key, modifiers) => {
    render(<KeyMode />);
    fireEvent.keyDown(window, { key, ...modifiers });
    expect(keysOn()).toBe(false);
  });

  it("shows them at once on a later visit", () => {
    localStorage.setItem(STORAGE_KEY, "1");
    render(<KeyMode />);
    expect(keysOn()).toBe(true);
  });

  it("leaves them off on a touch-only device, whose software keyboard fires keydown too", () => {
    stubDevice(true);
    render(<KeyMode />);
    fireEvent.keyDown(window, { key: "a" });
    expect(keysOn()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("turns them on at the first key on a fine pointer", () => {
    stubDevice(false);
    render(<KeyMode />);
    fireEvent.keyDown(window, { key: "a" });
    expect(keysOn()).toBe(true);
  });

  it.each([
    ["Process", { isComposing: true }],
    ["Process", {}],
    ["Unidentified", {}],
    ["a", { isComposing: true }],
  ])("does not count a composing %s as using the keys", (key, init) => {
    render(<KeyMode />);
    fireEvent.keyDown(window, { key, ...init });
    expect(keysOn()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
