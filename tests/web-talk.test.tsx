import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { browserSound } from "@instant-composition/web";

import {
  COUNT,
  fakeApi,
  fakeTimers,
  fill,
  homeView,
  ja,
  navigations,
  refusal,
  renderApp,
  settle,
  warmUp,
} from "./web-harness";
import {
  MODEL_ANSWER,
  OPENING,
  POINT,
  SCENE,
  begin,
  opened,
  posted,
  press,
  say,
  serveTalk,
  turnResult,
  write,
} from "./web-talk-harness";

// The talk screen, mounted as the whole app at `/talk` over a stand-in API:
// W2's start, each step of a turn, the issue's four worked examples, the keys
// and what a screen reader hears. The failures and the leave guard are in
// tests/web-talk-leave.test.tsx.

const TURNS = /^\/api\/v1\/talks\/[^/]+\/turns$/u;

function announced(): string {
  return document.querySelector("[aria-live=polite]")?.textContent ?? "";
}

function progress(current: number): string {
  return fill(ja.Talk.strip.progress, { current, total: 6 });
}

/** Presses `key` on whatever has focus, as a real key press would reach it. */
function key(name: string): void {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  });
}

beforeAll(warmUp);

beforeEach(() => {
  fakeTimers();
});

afterEach(() => {
  act(() => {
    window.history.replaceState(null, "", "/");
  });
});

describe("W2, the talk tab before a talk", () => {
  it("shows six turns, the scene left to the app, and 始める, under a tab bar with talk current", async () => {
    serveTalk();
    await renderApp("/talk");
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText(ja.Talk.start.turns)).toBeInTheDocument();
    expect(screen.getByText(ja.Talk.start.scene)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ja.Talk.start.go })).toBeEnabled();
    expect(navigations()).toStrictEqual([
      [
        ["/", null],
        ["/talk", "page"],
        ["/records", null],
        ["/settings", null],
      ],
    ]);
  });

  it("says 用意しています on a start that cannot be pressed again while the scene is made", async () => {
    let answer: (response: Response) => void = () => undefined;
    const calls = serveTalk({
      start: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    await renderApp("/talk");
    press(ja.Talk.start.go);
    await settle();
    expect(
      screen.getByRole("button", { name: ja.Talk.start.preparing }),
    ).toBeDisabled();

    const [start] = posted(calls, /^\/api\/v1\/talks$/u) as { talkId: string }[];
    expect(start?.talkId).toMatch(/^[\da-f-]{36}$/u);
    answer(Response.json(opened(start?.talkId ?? "")));
    await settle();
    expect(screen.getByText(SCENE)).toBeInTheDocument();
    expect(screen.getByText(OPENING)).toBeInTheDocument();
    expect(screen.getByText(progress(1))).toBeInTheDocument();
    expect(announced()).toBe(
      fill(ja.Talk.announce.line, { speaker: ja.Talk.speaker.partner, text: OPENING }),
    );
  });

  it.each([
    ["the model could not make the scene", () => refusal(503, "ERR_MODEL_UNAVAILABLE")],
    ["nothing readable came back", () => new Response("<html>", { status: 502 })],
  ])("says it could not start when %s, and starts on もう一度", async (_, failure) => {
    const calls = serveTalk({
      start: (talkId, asked) =>
        asked === 0 ? failure() : Response.json(opened(talkId)),
    });
    await renderApp("/talk");
    await begin();
    expect(
      screen.getByRole("heading", { name: ja.Talk.start.failed }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ja.Talk.start.go })).toBeNull();

    press(ja.Talk.start.retry);
    await settle();
    expect(screen.getByText(OPENING)).toBeInTheDocument();
    expect(posted(calls, /^\/api\/v1\/talks$/u)).toHaveLength(2);
  });
});

describe("the talk tab's read", () => {
  it("sends a signed-out visitor to the landing", async () => {
    fakeApi(() => refusal(401, "ERR_UNAUTHENTICATED"));
    await renderApp("/talk");
    expect(window.location.pathname).toBe("/");
  });

  it("says the view could not be read, and shows W2 once it reads again", async () => {
    let reads = 0;
    fakeApi((call) => {
      if (call.url !== "/api/v1/home") return undefined;
      reads += 1;
      return reads === 1
        ? refusal(503, "ERR_UNAVAILABLE")
        : Response.json(homeView({ kind: "ready", streak: COUNT }));
    });
    await renderApp("/talk");
    press(ja.Home.loadFailed.reload);
    await settle();
    expect(screen.getByRole("button", { name: ja.Talk.start.go })).toBeInTheDocument();
  });
});

describe("one turn", () => {
  it("cannot send an empty Japanese, and sends nothing until the English goes with it", async () => {
    const calls = serveTalk();
    await renderApp("/talk");
    await begin();
    expect(screen.getByRole("textbox", { name: ja.Talk.step.japanese })).toHaveFocus();
    expect(screen.getByRole("button", { name: ja.Talk.step.send })).toBeDisabled();
    write(ja.Talk.step.japanese, "   ");
    expect(screen.getByRole("button", { name: ja.Talk.step.send })).toBeDisabled();

    write(ja.Talk.step.japanese, "仕事が詰まってて");
    key("Enter");
    await settle();
    expect(screen.getByRole("textbox", { name: ja.Talk.step.english })).toHaveFocus();
    expect(screen.getByText("仕事が詰まってて")).toBeInTheDocument();
    expect(posted(calls, TURNS)).toStrictEqual([]);
  });

  it("example 1: a fine English is lit with the ○, then the next partner line follows with no recital", async () => {
    const calls = serveTalk();
    await renderApp("/talk");
    await begin();
    await say("仕事が詰まってて", "I was swamped with work.");

    const english = screen.getByText("I was swamped with work.");
    expect(english).toHaveClass("text-good-ink");
    expect(english.querySelector("svg")).not.toBeNull();
    expect(announced()).toBe(ja.Talk.announce.fine);
    expect(screen.queryByRole("button", { name: ja.Talk.teacher.hide })).toBeNull();

    await settle(320);
    expect(screen.getByText("reply-1")).toBeInTheDocument();
    expect(screen.getByText(progress(2))).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: ja.Talk.step.japanese }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ja.Talk.teacher.hide })).toBeNull();
    expect(screen.getByText("I was swamped with work.")).not.toHaveClass(
      "text-good-ink",
    );
    expect(posted(calls, TURNS)).toStrictEqual([
      { turn: 1, japanese: "仕事が詰まってて", english: "I was swamped with work." },
    ]);
    expect(posted(calls, /\/reply$/u)).toStrictEqual([]);
    expect(posted(calls, /\/recital$/u)).toStrictEqual([]);
  });

  it.each([
    [true, [["ok"]]],
    [false, []],
  ])(
    "with sound %s, plays the drill's ○ sound accordingly on a fine turn",
    async (sound, plays) => {
      const play = vi.spyOn(browserSound, "play");
      serveTalk({ home: homeView({ kind: "ready", streak: COUNT }, { sound }) });
      await renderApp("/talk");
      await begin();
      await say("仕事が詰まってて", "I was swamped with work.");
      expect(play.mock.calls).toStrictEqual(plays);
    },
  );

  it("shows the learner's English, the model answer and the point when it is worth correcting", async () => {
    serveTalk({ turn: (body) => Response.json(turnResult("corrected", body.turn)) });
    await renderApp("/talk");
    await begin();
    await say("仕事が詰まってて", "I was very busy with work.");
    const teacher = document.querySelector("[data-slot=teacher-line]");
    expect(teacher?.querySelector("[data-part=your-english]")?.textContent).toContain(
      "I was very busy with work.",
    );
    expect(screen.getByText(MODEL_ANSWER)).toBeInTheDocument();
    expect(screen.getByText(POINT)).toBeInTheDocument();
    expect(announced()).toBe(
      fill(ja.Talk.announce.line, {
        speaker: ja.Talk.speaker.teacher,
        text: MODEL_ANSWER,
      }),
    );
    expect(screen.queryByText("reply-1")).toBeNull();
  });

  it("example 2: a give-up shows no English of the learner's, and 言えた sends how often they looked again", async () => {
    const calls = serveTalk({
      turn: (body) => Response.json(turnResult("corrected", body.turn)),
    });
    await renderApp("/talk");
    await begin();
    await say("仕事が詰まってて", null);
    expect(posted(calls, TURNS)).toStrictEqual([
      { turn: 1, japanese: "仕事が詰まってて", english: null },
    ]);
    const teacher = document.querySelector("[data-slot=teacher-line]");
    expect(teacher).not.toBeNull();
    expect(teacher?.querySelector("[data-part=your-english]")).toBeNull();
    expect(screen.getByText(MODEL_ANSWER)).toBeInTheDocument();

    press(ja.Talk.teacher.hide);
    expect(screen.queryByText(MODEL_ANSWER)).toBeNull();
    expect(screen.getByText(ja.Talk.teacher.aloud)).toBeInTheDocument();
    expect(screen.getByText(POINT)).toBeInTheDocument();
    expect(announced()).toBe(ja.Talk.teacher.hidden);

    for (let look = 0; look < 2; look += 1) {
      press(ja.Talk.teacher.lookAgain);
      expect(screen.getByText(MODEL_ANSWER)).toBeInTheDocument();
      press(ja.Talk.teacher.hide);
    }
    press(ja.Talk.teacher.said);
    await settle();
    expect(posted(calls, /\/turns\/1\/recital$/u)).toStrictEqual([{ revealCount: 2 }]);
    expect(screen.getByText("reply-1")).toBeInTheDocument();
    expect(screen.getByText(progress(2))).toBeInTheDocument();
  });

  it("example 3: English in Japanese stays in the field, with 英語で入力してください under it, and nothing is sent", async () => {
    const calls = serveTalk();
    await renderApp("/talk");
    await begin();
    write(ja.Talk.step.japanese, "仕事が詰まってて");
    press(ja.Talk.step.send);
    await settle();
    write(ja.Talk.step.english, "仕事が忙しい");
    press(ja.Talk.step.send);
    await settle();
    expect(screen.getByRole("textbox", { name: ja.Talk.step.english })).toHaveValue(
      "仕事が忙しい",
    );
    expect(screen.getByText(ja.Talk.step.notEnglish)).toBeInTheDocument();
    expect(posted(calls, TURNS)).toStrictEqual([]);

    write(ja.Talk.step.english, "I was busy.");
    expect(screen.queryByText(ja.Talk.step.notEnglish)).toBeNull();
  });

  it("example 4: turn 6's reply ends the talk at おわり with no ✕, and 新しい会話 prepares another", async () => {
    let starts = 0;
    serveTalk({
      start: (talkId) => {
        starts += 1;
        return starts === 1
          ? Response.json(opened(talkId))
          : new Promise<Response>(() => undefined);
      },
    });
    await renderApp("/talk");
    await begin();
    for (let turn = 1; turn <= 6; turn += 1) {
      await say(`日本語-${String(turn)}`, `English ${String(turn)}.`);
      await settle(320);
    }
    expect(screen.getByText("reply-6")).toBeInTheDocument();
    expect(screen.getByText(ja.Talk.end.mark)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ja.Talk.strip.close })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();

    press(ja.Talk.end.again);
    await settle();
    expect(
      screen.getByRole("button", { name: ja.Talk.start.preparing }),
    ).toBeDisabled();
  });
});

describe("the talk's keys", () => {
  it("presses 隠して言う on Enter in W3e and 言えた on Enter in W3f", async () => {
    const calls = serveTalk({
      turn: (body) => Response.json(turnResult("corrected", body.turn)),
    });
    await renderApp("/talk");
    await begin();
    await say("仕事が詰まってて", "I was very busy.");
    key("Enter");
    expect(screen.getByText(ja.Talk.teacher.aloud)).toBeInTheDocument();
    key("Enter");
    await settle();
    expect(posted(calls, /\/recital$/u)).toStrictEqual([{ revealCount: 0 }]);
    expect(screen.getByText("reply-1")).toBeInTheDocument();
  });

  it("starts a talk on Enter from W2", async () => {
    serveTalk();
    await renderApp("/talk");
    key("Enter");
    await settle();
    expect(screen.getByText(OPENING)).toBeInTheDocument();
  });

  it("goes home on Escape from W2, with no talk to lose", async () => {
    serveTalk();
    await renderApp("/talk");
    key("Escape");
    await settle();
    expect(window.location.pathname).toBe("/");
  });

  it("leaves a field's Enter to the field, so an empty one sends nothing", async () => {
    const calls = serveTalk();
    await renderApp("/talk");
    await begin();
    write(ja.Talk.step.japanese, "仕事");
    fireEvent.click(screen.getByRole("textbox", { name: ja.Talk.step.japanese }));
    key("Enter");
    await settle();
    write(ja.Talk.step.english, "");
    key("Enter");
    await settle();
    expect(
      screen.getByRole("textbox", { name: ja.Talk.step.english }),
    ).toBeInTheDocument();
    expect(posted(calls, TURNS)).toStrictEqual([]);
  });
});
