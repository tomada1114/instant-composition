import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { TUNING } from "@instant-composition/web";

import {
  fakeTimers,
  fill,
  ja,
  landmarks,
  navigations,
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
  write,
} from "./web-talk-harness";

// The talk screen's failures — each row of ux-flows §4.4, none of them in red
// — and W4, the question asked before a talk under way is left by ✕, Esc or
// Back.

const TURNS = /\/turns$/u;
const REPLY = /\/reply$/u;
const END = /\/end$/u;

function where(): string {
  return window.location.pathname;
}

function leaveSheet(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: ja.Talk.leave.title });
}

/** The conversation, which alone holds the lines and the end mark. */
function conversation(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-conversation]");
  if (element === null) throw new Error("No conversation on screen.");
  return element;
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
    expect(within(conversation()).getByText(ja.Talk.end.mark)).toBeInTheDocument();
  });

  it.each([
    ["sendTurn", 404, "ERR_TALK_NOT_FOUND", ja.Talk.toast.save],
    ["sendTurn", 409, "ERR_TALK_CLOSED", ""],
    ["retryReply", 404, "ERR_TALK_NOT_FOUND", ja.Talk.toast.save],
    ["retryReply", 409, "ERR_TALK_CLOSED", ""],
  ] as const)(
    "ends the talk at おわり without endTalk when %s answers %i %s",
    async (call, status, code, notice) => {
      const calls = serveTalk(
        call === "sendTurn"
          ? { turn: () => refusal(status, code) }
          : {
              turn: (body) => Response.json(turnResult("fine", body.turn, null)),
              reply: () => refusal(status, code),
            },
      );
      await renderApp("/talk");
      await begin();
      await say("仕事が詰まってて", "I was swamped with work.");
      if (call === "retryReply") {
        await settle(320);
        expect(screen.getByText(ja.Talk.reply.failed)).toBeInTheDocument();
        press(ja.Talk.reply.retry);
        await settle();
      }
      expect(within(conversation()).getByText(ja.Talk.end.mark)).toBeInTheDocument();
      expect(screen.queryByText(ja.Talk.reply.failed)).toBeNull();
      expect(screen.queryByRole("button", { name: ja.Talk.reply.retry })).toBeNull();
      expect(screen.queryByRole("button", { name: ja.Talk.strip.close })).toBeNull();
      expect(
        screen.getByRole("button", { name: ja.Talk.end.again }),
      ).toBeInTheDocument();
      expect(toast()).toBe(notice);
      expect(posted(calls, END)).toStrictEqual([]);
      expect(posted(calls, call === "sendTurn" ? TURNS : REPLY)).toHaveLength(1);
    },
  );

  it("leaves W3g when a retried turn finds the talk gone", async () => {
    const calls = serveTalk({
      turn: (_body, asked) =>
        asked === 0
          ? refusal(503, "ERR_MODEL_UNAVAILABLE")
          : refusal(404, "ERR_TALK_NOT_FOUND"),
    });
    await renderApp("/talk");
    await begin();
    await say("仕事が詰まってて", "I was swamped with work.");
    expect(screen.getByText(ja.Talk.reply.failed)).toBeInTheDocument();

    press(ja.Talk.reply.retry);
    await settle();
    expect(within(conversation()).getByText(ja.Talk.end.mark)).toBeInTheDocument();
    expect(toast()).toBe(ja.Talk.toast.save);
    expect(posted(calls, TURNS)).toHaveLength(2);
    expect(posted(calls, END)).toStrictEqual([]);
  });

  it("stays on W3g for any other refusal of a turn", async () => {
    serveTalk({ turn: () => refusal(409, "ERR_CONFLICT") });
    await renderApp("/talk");
    await begin();
    await say("仕事が詰まってて", "I was swamped with work.");
    expect(screen.getByText(ja.Talk.reply.failed)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: ja.Talk.reply.retry }),
    ).toBeInTheDocument();
    expect(within(conversation()).queryByText(ja.Talk.end.mark)).toBeNull();
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
  it("does not bring W4 back with the next talk when the talk ended under a ✕-opened W4", async () => {
    serveTalk({ turn: () => refusal(409, "ERR_TALK_CLOSED") });
    await renderApp("/talk");
    await begin();
    write(ja.Talk.step.japanese, "仕事が詰まってて");
    press(ja.Talk.step.send);
    await settle();
    write(ja.Talk.step.english, "I was swamped with work.");
    press(ja.Talk.step.send);
    press(ja.Talk.strip.close);
    expect(leaveSheet()).not.toBeNull();
    await settle();
    await settle(16);
    expect(leaveSheet()).toBeNull();
    expect(within(conversation()).getByText(ja.Talk.end.mark)).toBeInTheDocument();

    press(ja.Talk.end.again);
    await settle();
    await settle(16);
    expect(leaveSheet()).toBeNull();
  });
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
    expect(within(conversation()).getByText(ja.Talk.end.mark)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ja.Talk.strip.close })).toBeNull();
    expect(screen.getByRole("button", { name: ja.Talk.end.again })).toBeInTheDocument();
    expect(where()).toBe("/talk");
  });

  it("shows no held closing line when turn 6 is ended by 終える from ✕ before 言えた", async () => {
    serveTalk({
      turn: (body) =>
        Response.json(turnResult(body.turn === 6 ? "corrected" : "fine", body.turn)),
    });
    await renderApp("/talk");
    await begin();
    for (let turn = 1; turn <= 5; turn += 1) {
      await say(`日本語-${String(turn)}`, `English ${String(turn)}.`);
      await settle(320);
    }
    await say("日本語-6", "English 6.");
    expect(screen.getByText(MODEL_ANSWER)).toBeInTheDocument();
    press(ja.Talk.strip.close);
    press(ja.Talk.leave.end);
    await settle();
    expect(within(conversation()).getByText(ja.Talk.end.mark)).toBeInTheDocument();
    expect(screen.queryByText("reply-6")).toBeNull();
  });

  it("trades the navigation for the focus strip from the first line to the end", async () => {
    serveTalk();
    await renderApp("/talk");
    expect(landmarks()).toStrictEqual(["navigation", "main"]);
    await begin();
    expect(navigations()).toStrictEqual([]);
    expect(landmarks()).toStrictEqual(["main"]);
    const close = screen.getByRole("button", { name: ja.Talk.strip.close });
    expect(close.closest("[data-part=focus-strip]")).not.toBeNull();

    press(ja.Talk.strip.close);
    press(ja.Talk.leave.end);
    await settle();
    expect(navigations()).toStrictEqual([]);
    expect(within(conversation()).getByText(ja.Talk.end.mark)).toBeInTheDocument();
    expect(where()).toBe("/talk");
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
    ["before a talk, by a section", false, ja.Nav.home],
    ["after it ended, by the strip's ✕", true, ja.Nav.close],
  ])("leaves at once %s", async (_, ended, link) => {
    serveTalk();
    await renderApp("/talk");
    if (ended) {
      await begin();
      press(ja.Talk.strip.close);
      press(ja.Talk.leave.end);
      await settle();
    }
    fireEvent.click(screen.getByRole("link", { name: link }));
    await settle();
    expect(leaveSheet()).toBeNull();
    expect(where()).toBe("/");
  });
});
