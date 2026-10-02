import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { browserSound, TALK_STORAGE_KEY } from "@instant-composition/web";

import {
  COUNT,
  fakeApi,
  fakeTimers,
  fill,
  homeView,
  ja,
  landmarks,
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
  savedTalk,
  talkView,
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

function doneTurns(): number {
  return document.querySelectorAll("[data-part=focus-strip] [data-done]").length;
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
  savedTalk(null);
  fakeTimers();
});

afterEach(() => {
  act(() => {
    window.history.replaceState(null, "", "/");
  });
});

describe("resuming on this browser", () => {
  it("saves the opened id and reloads at turn 4 with three kept turns and their feedback", async () => {
    const calls = serveTalk({
      turn: (body) => Response.json(turnResult("corrected", body.turn)),
      read: (talkId) => Response.json(talkView(talkId)),
    });
    await renderApp("/talk");
    await begin();
    const talkId = localStorage.getItem(TALK_STORAGE_KEY);
    expect(talkId).toBeTypeOf("string");
    for (const n of [1, 2, 3]) {
      await say(`日本語-${String(n)}`, n === 2 ? null : `english-${String(n)}`);
      if (n < 3) {
        press(ja.Talk.teacher.hide);
        press(ja.Talk.teacher.said);
        await settle();
      }
    }
    cleanup();
    await renderApp("/talk");
    expect(screen.getByText(SCENE)).toBeInTheDocument();
    for (const n of [1, 2, 3])
      expect(screen.getByText(`日本語-${String(n)}`)).toBeInTheDocument();
    expect(screen.getAllByText("english-1")[0]).toBeInTheDocument();
    expect(screen.getAllByText("english-3")[0]).toBeInTheDocument();
    expect(screen.getAllByText(MODEL_ANSWER)).toHaveLength(3);
    expect(screen.getAllByText(POINT)).toHaveLength(3);
    expect(screen.getByText(progress(4))).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: ja.Talk.step.japanese }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ja.Talk.teacher.hide })).toBeNull();
    expect(
      calls.filter(
        (call) =>
          call.method === "GET" && call.url === `/api/v1/talks/${String(talkId)}`,
      ),
    ).toHaveLength(1);
    await say("次の日本語", "Next turn.");
    expect(posted(calls, TURNS).at(-1)).toMatchObject({ turn: 4 });
  });

  it("stays preparing while reading the saved id", async () => {
    savedTalk("held");
    let resolve: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((deliver) => {
      resolve = deliver;
    });
    serveTalk({ read: () => pending });
    await renderApp("/talk");
    expect(
      screen.getByRole("button", { name: ja.Talk.start.preparing }),
    ).toBeDisabled();
    if (resolve === undefined) throw new Error("The read must be pending.");
    resolve(Response.json(talkView("held", 0)));
    await settle();
    expect(screen.getByText(OPENING)).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: ja.Talk.step.japanese }),
    ).toBeInTheDocument();
  });

  it("skips the recital and retries a kept turn's missing partner reply", async () => {
    savedTalk("held");
    const view = talkView("held", 2);
    const calls = serveTalk({
      read: () =>
        Response.json({
          ...view,
          turns: view.turns.map((turn) => ({
            ...turn,
            reply: turn.turn === 2 ? null : turn.reply,
          })),
        }),
      reply: () => Response.json({ line: "Reply recovered.", closing: false }),
    });
    await renderApp("/talk");
    expect(screen.getByText(ja.Talk.reply.failed)).toBeInTheDocument();
    expect(screen.getAllByText(MODEL_ANSWER)).toHaveLength(2);
    press(ja.Talk.reply.retry);
    await settle();
    expect(screen.getByText("Reply recovered.")).toBeInTheDocument();
    expect(screen.getByText(progress(3))).toBeInTheDocument();
    expect(posted(calls, /\/reply$/u)).toHaveLength(1);
    expect(posted(calls, TURNS)).toHaveLength(0);
    expect(posted(calls, /\/recital$/u)).toHaveLength(0);
  });

  it("quietly clears an expired id and returns to W2", async () => {
    savedTalk("expired");
    serveTalk({ read: () => refusal(404, "ERR_TALK_NOT_FOUND") });
    await renderApp("/talk");
    expect(screen.getByRole("button", { name: ja.Talk.start.go })).toBeEnabled();
    expect(localStorage.getItem(TALK_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it.each(["finished", "ended", "discarded"] as const)(
    "quietly clears a %s talk instead of resuming it",
    async (status) => {
      savedTalk("closed");
      serveTalk({ read: () => Response.json({ ...talkView("closed"), status }) });
      await renderApp("/talk");
      expect(screen.getByRole("button", { name: ja.Talk.start.go })).toBeEnabled();
      expect(localStorage.getItem(TALK_STORAGE_KEY)).toBeNull();
      expect(screen.getByRole("status")).toHaveTextContent("");
    },
  );

  it("shows the step after a closing reply and clears the id", async () => {
    savedTalk("closing");
    serveTalk({ read: () => Response.json(talkView("closing", 6)) });
    await renderApp("/talk");
    expect(screen.getByText(ja.Talk.end.mark)).toBeInTheDocument();
    expect(screen.getByText("reply-6")).toBeInTheDocument();
    expect(localStorage.getItem(TALK_STORAGE_KEY)).toBeNull();
  });

  it("guards leaving a resumed talk and clears the id when it is explicitly ended", async () => {
    savedTalk("held");
    serveTalk({ read: () => Response.json(talkView("held")) });
    await renderApp("/talk");
    press(ja.Talk.strip.close);
    expect(
      screen.getByRole("dialog", { name: ja.Talk.leave.title }),
    ).toBeInTheDocument();
    press(ja.Talk.leave.stay);
    expect(localStorage.getItem(TALK_STORAGE_KEY)).toBe("held");
    press(ja.Talk.strip.close);
    press(ja.Talk.leave.end);
    await settle();
    expect(localStorage.getItem(TALK_STORAGE_KEY)).toBeNull();
    cleanup();
    await renderApp("/talk");
    expect(screen.getByRole("button", { name: ja.Talk.start.go })).toBeEnabled();
  });

  it("starts at W2 on a browser without an id", async () => {
    const calls = serveTalk();
    await renderApp("/talk");
    expect(screen.getByRole("button", { name: ja.Talk.start.go })).toBeEnabled();
    expect(calls.filter((call) => call.url.includes("/talks/"))).toHaveLength(0);
  });

  it("retries a transient read failure without starting another talk", async () => {
    savedTalk("held");
    let reads = 0;
    const calls = serveTalk({
      read: () => {
        reads += 1;
        return reads === 1
          ? refusal(503, "ERR_INTERNAL")
          : Response.json(talkView("held", 0));
      },
    });
    await renderApp("/talk");
    expect(
      screen.getByRole("heading", { name: ja.Talk.start.failed }),
    ).toBeInTheDocument();
    press(ja.Talk.start.retry);
    await settle();
    expect(screen.getByText(OPENING)).toBeInTheDocument();
    expect(reads).toBe(2);
    expect(posted(calls, /^\/api\/v1\/talks$/u)).toHaveLength(0);
  });

  it("keeps talking when reading or writing browser storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Unavailable storage");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Unavailable storage");
    });
    serveTalk();
    await renderApp("/talk");
    expect(screen.getByRole("button", { name: ja.Talk.start.go })).toBeEnabled();
    await begin();
    expect(screen.getByText(OPENING)).toBeInTheDocument();
    await say("日本語", "English.");
    await settle(320);
    expect(screen.getByText("reply-1")).toBeInTheDocument();
  });

  it("can end and start fresh even when removing the saved id throws", async () => {
    savedTalk("held");
    const calls = serveTalk({ read: () => Response.json(talkView("held", 0)) });
    await renderApp("/talk");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("Unavailable storage");
    });
    press(ja.Talk.strip.close);
    press(ja.Talk.leave.end);
    await settle();
    expect(screen.getByRole("button", { name: ja.Talk.end.again })).toBeInTheDocument();
    press(ja.Talk.end.again);
    await settle();
    expect(screen.getByText(OPENING)).toBeInTheDocument();
    expect(posted(calls, /^\/api\/v1\/talks$/u)).toHaveLength(1);
  });

  it("ignores an older mount's late missing response without clearing a new talk", async () => {
    savedTalk("old");
    let resolve: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((deliver) => {
      resolve = deliver;
    });
    serveTalk({ read: () => pending });
    await renderApp("/talk");
    cleanup();
    savedTalk(null);
    await renderApp("/talk");
    await begin();
    const current = localStorage.getItem(TALK_STORAGE_KEY);
    expect(current).toBeTypeOf("string");
    if (resolve === undefined) throw new Error("The old read must be pending.");
    resolve(refusal(404, "ERR_TALK_NOT_FOUND"));
    await settle();
    expect(localStorage.getItem(TALK_STORAGE_KEY)).toBe(current);
    expect(
      screen.getByRole("textbox", { name: ja.Talk.step.japanese }),
    ).toBeInTheDocument();
  });

  it("clears the id when even a fire-and-forget recital is not found", async () => {
    serveTalk({
      turn: (body) => Response.json(turnResult("corrected", body.turn)),
      recital: () => refusal(404, "ERR_TALK_NOT_FOUND"),
    });
    await renderApp("/talk");
    await begin();
    await say("日本語", "English.");
    press(ja.Talk.teacher.hide);
    press(ja.Talk.teacher.said);
    await settle();
    expect(localStorage.getItem(TALK_STORAGE_KEY)).toBeNull();
  });
});

describe("W2, the talk tab before a talk", () => {
  it("shows six turns, the scene left to the app, and 始める, under the navigation with talk current", async () => {
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
    expect(landmarks()).toStrictEqual(["navigation", "main"]);
  });

  it("lays out a turn's six steps as one line under the panel", async () => {
    serveTalk();
    await renderApp("/talk");
    const flow = screen.getByRole("list", { name: ja.Talk.start.flow });
    expect(
      [...flow.querySelectorAll("li")].map((step) => step.textContent),
    ).toStrictEqual([
      ja.Talk.speaker.partner,
      ja.Talk.step.japanese,
      ja.Talk.step.english,
      ja.Talk.start.model,
      ja.Talk.start.again,
      ja.Talk.speaker.partner,
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
  it("labels the keyboard's Enter next at the Japanese and send at the English", async () => {
    serveTalk();
    await renderApp("/talk");
    await begin();
    expect(
      screen.getByRole("textbox", { name: ja.Talk.step.japanese }),
    ).toHaveAttribute("enterkeyhint", "next");
    write(ja.Talk.step.japanese, "仕事が詰まってて");
    key("Enter");
    await settle();
    expect(screen.getByRole("textbox", { name: ja.Talk.step.english })).toHaveAttribute(
      "enterkeyhint",
      "send",
    );
  });

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

    expect(doneTurns()).toBe(0);
    await settle(320);
    expect(screen.getByText("reply-1")).toBeInTheDocument();
    expect(screen.getByText(progress(2))).toBeInTheDocument();
    expect(doneTurns()).toBe(1);
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
