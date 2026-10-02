import { act, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TUNING } from "@instant-composition/web";

import { fakeTimers, ja, renderApp, settle, warmUp } from "./web-harness";
import { begin, posted, press, serveTalk, write } from "./web-talk-harness";

// Voice input at W3a and W3b, driven through a stand-in for the browser's
// recognition object: jsdom has none, and no test reaches a microphone. Each
// case plays the events Chrome would fire — start, results, an error, an end
// — and the 2 s and 10 s waits run on fake timers.

const TURNS = /^\/api\/v1\/talks\/[^/]+\/turns$/u;

class FakeRecognition {
  static made: FakeRecognition[] = [];
  lang = "";
  interimResults = false;
  continuous = false;
  started = false;
  aborted = false;
  onstart: (() => void) | null = null;
  onresult: ((event: { results: { transcript: string }[][] }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeRecognition.made.push(this);
  }

  start(): void {
    this.started = true;
  }

  abort(): void {
    this.aborted = true;
  }
}

function session(): FakeRecognition {
  const last = FakeRecognition.made.at(-1);
  if (last === undefined) throw new Error("no recognition session was started");
  return last;
}

function listen(): void {
  act(() => {
    session().onstart?.();
  });
}

/** The browser's results so far, each one a separate segment of what was heard. */
function hear(...segments: string[]): void {
  act(() => {
    session().onresult?.({ results: segments.map((transcript) => [{ transcript }]) });
  });
}

function fail(error: string): void {
  act(() => {
    session().onerror?.({ error });
  });
}

function key(name: string): void {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  });
}

function field(name: string): HTMLTextAreaElement {
  return screen.getByRole<HTMLTextAreaElement>("textbox", { name });
}

function notice(): string {
  return document.querySelector("[data-part=speech-notice]")?.textContent ?? "";
}

/** Renders the talk with recognition available, at W3a. */
async function atJapanese(): Promise<ReturnType<typeof serveTalk>> {
  vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
  const calls = serveTalk();
  await renderApp("/talk");
  await begin();
  return calls;
}

/** Renders the talk with recognition available, at W3b after `japanese` was typed. */
async function atEnglish(
  japanese = "仕事が詰まってて",
): Promise<ReturnType<typeof serveTalk>> {
  const calls = await atJapanese();
  write(ja.Talk.step.japanese, japanese);
  press(ja.Talk.step.send);
  await settle();
  return calls;
}

beforeAll(warmUp);

beforeEach(() => {
  fakeTimers();
  FakeRecognition.made = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => {
    window.history.replaceState(null, "", "/");
  });
});

describe("where the browser has speech recognition", () => {
  it("example 7: shows no 話す without it, and W3a keeps one 送る", async () => {
    serveTalk();
    await renderApp("/talk");
    await begin();
    expect(screen.queryByRole("button", { name: ja.Talk.step.speak })).toBeNull();
    expect(screen.getByRole("button", { name: ja.Talk.step.send })).toBeInTheDocument();
  });

  it("shows 話す at W3a and W3b, with its Space hint only while the field is empty", async () => {
    await atJapanese();
    const speak = screen.getByRole("button", { name: ja.Talk.step.speak });
    expect(speak.querySelector("[data-slot=kbd]")?.textContent).toBe("Space");
    write(ja.Talk.step.japanese, "仕事");
    expect(
      screen
        .getByRole("button", { name: ja.Talk.step.speak })
        .querySelector("[data-slot=kbd]"),
    ).toBeNull();
    press(ja.Talk.step.send);
    await settle();
    expect(
      screen.getByRole("button", { name: ja.Talk.step.speak }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: ja.Talk.step.giveUp }),
    ).toBeInTheDocument();
  });
});

describe("one session", () => {
  it("example 1: Space in the empty Japanese field listens in ja-JP, and 2 s of silence moves to W3b", async () => {
    const calls = await atJapanese();
    key(" ");
    expect(session()).toMatchObject({
      lang: "ja-JP",
      interimResults: true,
      started: true,
    });
    expect(
      screen.getByRole("button", { name: ja.Talk.step.speak }),
    ).toBeInTheDocument();
    listen();
    expect(
      screen.getByRole("button", { name: ja.Talk.step.listening }),
    ).toBeInTheDocument();
    expect(notice()).toBe(ja.Talk.step.listening);

    hear("仕事が詰まってて");
    expect(field(ja.Talk.step.japanese)).toHaveValue("仕事が詰まってて");
    expect(field(ja.Talk.step.japanese)).toHaveAttribute("readonly");
    await settle(TUNING.speechSilenceMs - 1);
    expect(field(ja.Talk.step.japanese)).toBeInTheDocument();
    await settle(1);
    expect(field(ja.Talk.step.english)).toHaveFocus();
    expect(screen.getByText("仕事が詰まってて")).toBeInTheDocument();
    expect(session().aborted).toBe(true);
    expect(posted(calls, TURNS)).toStrictEqual([]);
  });

  it.each([
    ["Space", () => key(" ")],
    ["Enter", () => key("Enter")],
    ["送る", () => press(ja.Talk.step.send)],
    ["聞いています", () => press(ja.Talk.step.listening)],
  ])(
    "example 2: %s during an English session sends the turn at once",
    async (_how, end) => {
      const calls = await atEnglish();
      press(ja.Talk.step.speak);
      expect(session().lang).toBe("en-US");
      listen();
      hear("I was very", " busy with work");
      end();
      await settle();
      expect(posted(calls, TURNS)).toStrictEqual([
        { turn: 1, japanese: "仕事が詰まってて", english: "I was very busy with work" },
      ]);
    },
  );

  it("example 3: appends what was heard after typed English with one space", async () => {
    const calls = await atEnglish();
    write(ja.Talk.step.english, "I was");
    press(ja.Talk.step.speak);
    listen();
    hear("swamped with work");
    expect(field(ja.Talk.step.english)).toHaveValue("I was swamped with work");
    await settle(TUNING.speechSilenceMs);
    expect(posted(calls, TURNS)).toStrictEqual([
      { turn: 1, japanese: "仕事が詰まってて", english: "I was swamped with work" },
    ]);
  });

  it("appends heard Japanese after typed Japanese with no space", async () => {
    await atJapanese();
    write(ja.Talk.step.japanese, "仕事が");
    press(ja.Talk.step.speak);
    listen();
    hear("詰まってて");
    await settle(TUNING.speechSilenceMs);
    expect(screen.getByText("仕事が詰まってて")).toBeInTheDocument();
  });

  it("example 4: Esc puts the field back and keeps W4 closed; a second Esc opens it", async () => {
    const calls = await atJapanese();
    press(ja.Talk.step.speak);
    listen();
    hear("仕事が");
    key("Escape");
    expect(field(ja.Talk.step.japanese)).toHaveValue("");
    expect(field(ja.Talk.step.japanese)).not.toHaveAttribute("readonly");
    expect(screen.queryByText(ja.Talk.leave.title)).toBeNull();
    expect(notice()).toBe(ja.Talk.step.cancelled);
    await settle(TUNING.speechSilenceMs);
    expect(field(ja.Talk.step.japanese)).toHaveValue("");
    expect(posted(calls, TURNS)).toStrictEqual([]);

    key("Escape");
    expect(screen.getByText(ja.Talk.leave.title)).toBeInTheDocument();
  });

  it("example 6: stops quietly when nothing is heard for 10 s", async () => {
    await atJapanese();
    write(ja.Talk.step.japanese, "仕事");
    press(ja.Talk.step.speak);
    listen();
    await settle(TUNING.speechNoInputMs);
    expect(session().aborted).toBe(true);
    expect(field(ja.Talk.step.japanese)).toHaveValue("仕事");
    expect(
      screen.getByRole("button", { name: ja.Talk.step.speak }),
    ).toBeInTheDocument();
    expect(screen.queryByText(ja.Talk.step.micRefused)).toBeNull();
  });

  it("stops quietly on no-speech before anything is heard", async () => {
    await atJapanese();
    press(ja.Talk.step.speak);
    listen();
    fail("no-speech");
    expect(session().aborted).toBe(true);
    expect(field(ja.Talk.step.japanese)).toHaveValue("");
    expect(
      screen.getByRole("button", { name: ja.Talk.step.speak }),
    ).toBeInTheDocument();
  });

  it("sends what was heard when the browser ends the session by itself", async () => {
    await atJapanese();
    press(ja.Talk.step.speak);
    listen();
    hear("仕事が詰まってて");
    act(() => {
      session().onend?.();
    });
    await settle();
    expect(field(ja.Talk.step.english)).toBeInTheDocument();
    expect(screen.getByText("仕事が詰まってて")).toBeInTheDocument();
  });

  it("stops at 300 characters and sends the first 300", async () => {
    const calls = await atEnglish();
    const heard = "word ".repeat(70).trim();
    press(ja.Talk.step.speak);
    listen();
    hear(heard);
    await settle();
    expect(posted(calls, TURNS)).toStrictEqual([
      { turn: 1, japanese: "仕事が詰まってて", english: heard.slice(0, 300).trim() },
    ]);
  });

  it("keeps typed Japanese plus speech at W3b unsent, with 英語で入力してください", async () => {
    const calls = await atEnglish();
    write(ja.Talk.step.english, "仕事");
    press(ja.Talk.step.speak);
    listen();
    hear("is busy");
    await settle(TUNING.speechSilenceMs);
    expect(field(ja.Talk.step.english)).toHaveValue("仕事 is busy");
    expect(screen.getByText(ja.Talk.step.notEnglish)).toBeInTheDocument();
    expect(posted(calls, TURNS)).toStrictEqual([]);
  });
});

describe("a session that cannot listen", () => {
  it.each([
    ["not-allowed", ja.Talk.step.micRefused],
    ["service-not-allowed", ja.Talk.step.micRefused],
    ["audio-capture", ja.Talk.step.micMissing],
    ["network", ja.Talk.step.speechFailed],
  ])(
    "example 5: %s shows %s as a status, and typing still sends",
    async (error, line) => {
      await atJapanese();
      press(ja.Talk.step.speak);
      fail(error);
      expect(session().aborted).toBe(true);
      expect(screen.getByText(line)).toHaveAttribute("role", "status");
      expect(screen.getByText(line)).toHaveClass("text-muted-foreground");

      press(ja.Talk.step.speak);
      expect(screen.queryByText(line)).toBeNull();
      key("Escape");
      write(ja.Talk.step.japanese, "仕事が詰まってて");
      press(ja.Talk.step.send);
      await settle();
      expect(field(ja.Talk.step.english)).toBeInTheDocument();
    },
  );
});

describe("a session cut short", () => {
  it("stops when W4 opens from ✕, keeping what was heard in the field unsent", async () => {
    const calls = await atJapanese();
    press(ja.Talk.step.speak);
    listen();
    hear("仕事が");
    press(ja.Talk.strip.close);
    expect(screen.getByText(ja.Talk.leave.title)).toBeInTheDocument();
    expect(session().aborted).toBe(true);
    press(ja.Talk.leave.stay);
    await settle(TUNING.speechSilenceMs);
    expect(field(ja.Talk.step.japanese)).toHaveValue("仕事が");
    expect(field(ja.Talk.step.japanese)).not.toHaveAttribute("readonly");
    expect(posted(calls, TURNS)).toStrictEqual([]);
  });

  it("stops on わからない, which gives up as it does today", async () => {
    const calls = await atEnglish();
    press(ja.Talk.step.speak);
    listen();
    hear("I was");
    press(ja.Talk.step.giveUp);
    await settle();
    expect(session().aborted).toBe(true);
    expect(posted(calls, TURNS)).toStrictEqual([
      { turn: 1, japanese: "仕事が詰まってて", english: null },
    ]);
  });
});
