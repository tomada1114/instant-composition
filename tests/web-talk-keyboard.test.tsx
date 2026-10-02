import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeTimers, ja, navigations, renderApp, settle, warmUp } from "./web-harness";
import { begin, press, serveTalk, write } from "./web-talk-harness";

// The talk screen under an on-screen keyboard. jsdom has no `visualViewport`,
// so each test stands one in: a layout viewport 844 tall, and a visual one
// the keyboard shortens and iOS pans, as Safari reports them.

const LAYOUT_HEIGHT = 844;

class StubViewport extends EventTarget {
  height = LAYOUT_HEIGHT;
  offsetTop = 0;

  /** Reports a new visual viewport, as Safari does when its keyboard moves. */
  move(height: number, offsetTop: number, type: "resize" | "scroll" = "resize"): void {
    this.height = height;
    this.offsetTop = offsetTop;
    act(() => {
      this.dispatchEvent(new Event(type));
    });
  }
}

let viewport: StubViewport;

function field(name: string): HTMLElement {
  return screen.getByRole("textbox", { name });
}

function visible(): readonly [string, string] {
  const main = screen.getByRole("main");
  return [
    main.style.getPropertyValue("--visible-top"),
    main.style.getPropertyValue("--visible-height"),
  ];
}

/** Opens a talk at W3a, its Japanese field focused as the step begins. */
async function atW3a(): Promise<HTMLElement> {
  serveTalk();
  await renderApp("/talk");
  await begin();
  const japanese = field(ja.Talk.step.japanese);
  expect(japanese).toHaveFocus();
  return japanese;
}

beforeAll(warmUp);

beforeEach(() => {
  fakeTimers();
  viewport = new StubViewport();
  vi.stubGlobal("visualViewport", viewport);
  vi.stubGlobal("innerHeight", LAYOUT_HEIGHT);
});

afterEach(() => {
  act(() => {
    window.history.replaceState(null, "", "/");
  });
});

describe("the talk screen under an iOS keyboard", () => {
  it("sits in what the keyboard leaves visible, without the tab bar, while a field has focus", async () => {
    await atW3a();
    expect(navigations()).toHaveLength(1);

    viewport.move(420, 180);
    expect(navigations()).toStrictEqual([]);
    expect(visible()).toStrictEqual(["180px", "420px"]);
    expect(field(ja.Talk.step.japanese)).toBeVisible();
    expect(screen.getByRole("button", { name: ja.Talk.step.send })).toBeVisible();
  });

  it("follows the visual viewport as Safari pans it and the keyboard changes height", async () => {
    await atW3a();
    viewport.move(420, 180);

    viewport.move(420, 96, "scroll");
    expect(visible()).toStrictEqual(["96px", "420px"]);
    viewport.move(380, 96);
    expect(visible()).toStrictEqual(["96px", "380px"]);
    expect(navigations()).toStrictEqual([]);
  });

  it("brings the tab bar back on blur", async () => {
    const japanese = await atW3a();
    viewport.move(420, 180);
    expect(navigations()).toStrictEqual([]);

    act(() => {
      japanese.blur();
    });
    expect(navigations()).toHaveLength(1);
  });

  it("brings the tab bar back when the keyboard closes", async () => {
    await atW3a();
    viewport.move(420, 180);
    expect(navigations()).toStrictEqual([]);

    viewport.move(LAYOUT_HEIGHT, 0);
    expect(navigations()).toHaveLength(1);
  });

  it("stays lifted from W3a's field to W3b's as 送る swaps them", async () => {
    await atW3a();
    viewport.move(420, 180);

    write(ja.Talk.step.japanese, "最近仕事が詰まってて");
    press(ja.Talk.step.send);
    await settle();
    expect(field(ja.Talk.step.english)).toHaveFocus();
    expect(navigations()).toStrictEqual([]);
  });

  it("keeps the conversation at its bottom as the keyboard takes its height", async () => {
    await atW3a();
    const conversation = document.querySelector("[data-conversation]");
    if (!(conversation instanceof HTMLElement)) throw new Error("no conversation");
    Object.defineProperty(conversation, "scrollHeight", { value: 900 });
    Object.defineProperty(conversation, "scrollTop", { value: 0, writable: true });

    viewport.move(420, 180);
    expect(conversation.scrollTop).toBe(900);
    conversation.scrollTop = 0;
    viewport.move(380, 180);
    expect(conversation.scrollTop).toBe(900);
  });

  it("keeps the field's focus when a button under the lifted screen is pressed", async () => {
    await atW3a();
    viewport.move(420, 180);
    write(ja.Talk.step.japanese, "最近仕事が詰まってて");

    const pressed = fireEvent.mouseDown(
      screen.getByRole("button", { name: ja.Talk.step.send }),
    );
    expect(pressed).toBe(false);
  });
});

describe("the talk screen where the layout resizes for the keyboard", () => {
  it("keeps the tab bar and its own height while a field has focus, as on a desktop or Android", async () => {
    await atW3a();

    viewport.move(LAYOUT_HEIGHT, 0);
    expect(navigations()).toHaveLength(1);
    expect(visible()).toStrictEqual(["", ""]);
  });

  it("lets a button take the press as it always has", async () => {
    await atW3a();
    write(ja.Talk.step.japanese, "最近仕事が詰まってて");

    const pressed = fireEvent.mouseDown(
      screen.getByRole("button", { name: ja.Talk.step.send }),
    );
    expect(pressed).toBe(true);
  });
});
