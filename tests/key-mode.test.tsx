import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { KeyMode } from "../src/components/lib/key-mode";

const STORAGE_KEY = "instant-composition:keys";

function keysOn(): boolean {
  return document.documentElement.hasAttribute("data-keys");
}

afterEach(() => {
  document.documentElement.removeAttribute("data-keys");
  localStorage.clear();
});

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
});
