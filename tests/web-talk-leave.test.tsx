import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { TUNING } from "@instant-composition/web";

import {
  fakeTimers,
  fill,
  ja,
  press as pressKey,
  refusal,
  renderApp,
  settle,
  warmUp,
} from "./web-harness";
import {
  MODEL_ANSWER,
  OPENING,
  begin,
  posted,
  press,
  replyTo,
  say,
  serveTalk,
  turnResult,
} from "./web-talk-harness";

// The talk screen's failures — each row of ux-flows §4.4, none of them in red
// — and W4, the question asked before a talk under way is left by ✕, Esc, a
// tab or Back.

const TURNS = /\/turns$/u;
const REPLY = /\/reply$/u;
const END = /\/end$/u;

function where(): string {
  return window.location.pathname;
}

function leaveSheet(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: ja.Talk.leave.title });
}

function toast(): string {
  return screen.getByRole("status").textContent;
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

describe("the talk's failures", () => {
  it("goes on to the partner with a toast when the judgment failed, and the toast leaves after 4 s", async () => {
    serveTalk({ turn: (body) => Response.json(turnResult("failed", body.turn)) });
    await renderApp("/talk");
    await begin();
    await say("仕事が詰まってて", "I was busy.");
    expect(toast()).toBe(ja.Talk.toast.judgment);
    expect(screen.getByText("reply-1")).toBeInTheDocument();
    expect(screen.queryByText(MODEL_ANSWER)).toBeNull();
    expect(
      screen.getByRole("textbox", { name: ja.Talk.step.japanese }),
    ).toBeInTheDocument();
    await settle(TUNING.toastMs);
    expect(toast()).toBe("");
  });

  it("shows W3g when the reply did not arrive, and asks for it again on もう一度", async () => {
    const calls = serveTalk({
      turn: (body) => Response.json(turnResult("fine", body.turn, null)),
      reply: (asked) =>
        asked === 0 ? refusal(503, "ERR_MODEL_UNAVAILABLE") : Response.json(replyTo(1)),
    });
    await renderApp("/talk");
    await begin();
    await say("仕事が詰まってて", "I was swamped with work.");
    await settle(320);
    expect(screen.getByText(ja.Talk.reply.failed)).toBeInTheDocument();

    press(ja.Talk.reply.retry);
    await settle();
    expect(screen.getByText(ja.Talk.reply.failed)).toBeInTheDocument();
    press(ja.Talk.reply.retry);
    await settle();
    expect(screen.queryByText(ja.Talk.reply.failed)).toBeNull();
    expect(screen.getByText("reply-1")).toBeInTheDocument();
    expect(posted(calls, REPLY)).toHaveLength(2);
    expect(posted(calls, TURNS)).toHaveLength(1);
  });

  it("shows W3g after 言えた when a corrected turn's reply did not arrive", async () => {
    serveTalk({
      turn: (body) => Response.json(turnResult("corrected", body.turn, null)),
    });
    await renderApp("/talk");
    await begin();
    await say("仕事が詰まってて", "I was very busy.");
    press(ja.Talk.teacher.hide);
    press(ja.Talk.teacher.said);
    await settle();
    expect(screen.getByText(ja.Talk.reply.failed)).toBeInTheDocument();
  });

  it("sends the same turn again on もう一度 when the turn itself got no answer", async () => {
    const calls = serveTalk({
      turn: (body, asked) =>
        asked === 0
          ? refusal(503, "ERR_MODEL_UNAVAILABLE")
          : Response.json(turnResult("fine", body.turn)),
    });
    await renderApp("/talk");
    await begin();
    await say("仕事が詰まってて", "I was swamped with work.");
    expect(screen.getByText(ja.Talk.reply.failed)).toBeInTheDocument();

    press(ja.Talk.reply.retry);
    await settle();
    await settle(320);
    expect(screen.getByText("reply-1")).toBeInTheDocument();
    expect(posted(calls, TURNS)).toStrictEqual([
      { turn: 1, japanese: "仕事が詰まってて", english: "I was swamped with work." },
      { turn: 1, japanese: "仕事が詰まってて", english: "I was swamped with work." },
    ]);
    expect(posted(calls, REPLY)).toStrictEqual([]);
  });

  it("ends the talk anyway, with a toast, when ✕'s 終える could not be saved", async () => {
    serveTalk({ end: () => refusal(503, "ERR_UNAVAILABLE") });
    await renderApp("/talk");
    await begin();
    await say("仕事が詰まってて", "I was swamped with work.");
    await settle(320);
    press(ja.Talk.strip.close);
    press(ja.Talk.leave.end);
    await settle();
    expect(toast()).toBe(ja.Talk.toast.save);
    expect(
      within(screen.getByRole("main")).getByText(ja.Talk.end.mark),
    ).toBeInTheDocument();
  });

  it("uses no red anywhere in a failure", async () => {
    serveTalk({ turn: (body) => Response.json(turnResult("fine", body.turn, null)) });
    await renderApp("/talk");
    await begin();
    await say("仕事が詰まってて", "I was swamped with work.");
    await settle(320);
    expect(document.body.innerHTML).not.toMatch(/-red-|destructive/u);
  });
});

describe("W4, leaving a talk under way", () => {
  it("asks from ✕ that the talk will not be kept with no turn, stays on 続ける, and opens on Esc too", async () => {
    serveTalk();
    await renderApp("/talk");
    await begin();
    press(ja.Talk.strip.close);
    expect(leaveSheet()).toBeInTheDocument();
    expect(screen.getByText(ja.Talk.leave.lost)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ja.Talk.leave.stay })).toHaveFocus();
    press(ja.Talk.leave.stay);
    expect(leaveSheet()).toBeNull();
    expect(screen.getByText(OPENING)).toBeInTheDocument();

    pressKey("Escape");
    expect(leaveSheet()).toBeInTheDocument();
    pressKey("Escape");
    expect(leaveSheet()).toBeNull();
  });

  it("leaves an Esc that cancels an input method's conversion to the input method", async () => {
    serveTalk();
    await renderApp("/talk");
    await begin();
    act(() => {
      screen.getByRole("textbox", { name: ja.Talk.step.japanese }).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          isComposing: true,
          bubbles: true,
        }),
      );
    });
    expect(leaveSheet()).toBeNull();
  });

  it("keeps the turns so far on 終える from ✕, and ends at おわり with no ✕", async () => {
    const calls = serveTalk();
    await renderApp("/talk");
    await begin();
    await say("仕事が詰まってて", "I was swamped with work.");
    await settle(320);
    press(ja.Talk.strip.close);
    expect(
      screen.getByText(fill(ja.Talk.leave.kept, { count: 1 })),
    ).toBeInTheDocument();
    press(ja.Talk.leave.end);
    await settle();
    expect(posted(calls, END)).toHaveLength(1);
    expect(leaveSheet()).toBeNull();
    expect(
      within(screen.getByRole("main")).getByText(ja.Talk.end.mark),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ja.Talk.strip.close })).toBeNull();
    expect(screen.getByRole("button", { name: ja.Talk.end.again })).toBeInTheDocument();
    expect(where()).toBe("/talk");
  });

  it("asks before a tab leaves, then goes there on 終える and ends the talk", async () => {
    const calls = serveTalk();
    await renderApp("/talk");
    await begin();
    fireEvent.click(screen.getByRole("link", { name: ja.Nav.records }));
    await settle();
    expect(leaveSheet()).toBeInTheDocument();
    expect(where()).toBe("/talk");
    press(ja.Talk.leave.end);
    await settle();
    expect(where()).toBe("/records");
    expect(posted(calls, END)).toHaveLength(1);
  });

  it("stays on the talk when 続ける answers a tab", async () => {
    const calls = serveTalk();
    await renderApp("/talk");
    await begin();
    fireEvent.click(screen.getByRole("link", { name: ja.Nav.settings }));
    await settle();
    press(ja.Talk.leave.stay);
    await settle();
    expect(where()).toBe("/talk");
    expect(screen.getByText(OPENING)).toBeInTheDocument();
    expect(posted(calls, END)).toStrictEqual([]);
  });

  it("asks before Back leaves a talk, staying on 続ける and leaving on 終える", async () => {
    const calls = serveTalk();
    await renderApp("/");
    fireEvent.click(screen.getByRole("link", { name: ja.Nav.talk }));
    await settle();
    await begin();
    const back = async (): Promise<void> => {
      act(() => {
        window.history.back();
      });
      await settle();
      await settle(16);
    };

    await back();
    expect(leaveSheet()).toBeInTheDocument();
    press(ja.Talk.leave.stay);
    await settle();
    await settle(16);
    expect(where()).toBe("/talk");
    expect(screen.getByText(OPENING)).toBeInTheDocument();

    await back();
    press(ja.Talk.leave.end);
    await settle();
    await settle(16);
    expect(where()).toBe("/");
    expect(posted(calls, END)).toHaveLength(1);
  });

  it.each([
    ["before a talk", false],
    ["after it ended", true],
  ])("leaves at once by a tab %s", async (_, ended) => {
    serveTalk();
    await renderApp("/talk");
    if (ended) {
      await begin();
      press(ja.Talk.strip.close);
      press(ja.Talk.leave.end);
      await settle();
    }
    fireEvent.click(screen.getByRole("link", { name: ja.Nav.home }));
    await settle();
    expect(leaveSheet()).toBeNull();
    expect(where()).toBe("/");
  });
});
