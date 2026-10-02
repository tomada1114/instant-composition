import { fireEvent, screen } from "@testing-library/react";
import { TALK_STORAGE_KEY } from "@instant-composition/web";

import type {
  HomeView,
  PartnerReply,
  TalkOpened,
  TalkView,
  TurnResult,
  Verdict,
} from "@instant-composition/web";

import {
  COUNT,
  fakeApi,
  homeView,
  ja,
  refusal,
  settle,
  type ApiCall,
} from "./web-harness";

// What the talk screen's rendered suites share: a stand-in for the five
// /v1/talks operations behind `fetch`, the answers it is built from, and the
// presses that move a turn along. Nothing here asserts.

export const OPENING = "Haven't seen you in a while.";
export const SCENE = "近所のカフェ。顔なじみの店員が話しかけてくる。";
export const MODEL_ANSWER = "I've been swamped with work.";
export const POINT = "「詰まってて」→ swamped";

export function opened(talkId: string): TalkOpened {
  return {
    talkId,
    scene: {
      partner: "店員",
      place: "カフェ",
      relation: "顔なじみ",
      description: SCENE,
    },
    opening: OPENING,
  };
}

/** The line the partner answers turn `n` with; turn 6's closes the scene. */
export function replyTo(n: number): PartnerReply {
  return { line: `reply-${String(n)}`, closing: n === 6 };
}

export function turnResult(
  verdict: Verdict,
  n: number,
  reply: PartnerReply | null = replyTo(n),
): TurnResult {
  return { judgment: { verdict, modelAnswer: MODEL_ANSWER, point: POINT }, reply };
}

type Answer = Response | Promise<Response>;

export interface TalkServe {
  readonly home?: HomeView;
  readonly read?: (talkId: string) => Answer;
  readonly recital?: () => Answer;
  /** Answers each start, given how many came before it. */
  readonly start?: (talkId: string, asked: number) => Answer;
  /** Answers each turn sent, given its body and how many sends came before it. */
  readonly turn?: (
    body: { turn: number; english: string | null },
    asked: number,
  ) => Answer;
  readonly reply?: (asked: number) => Answer;
  readonly end?: () => Answer;
}

/** An API that answers the home view and the talk operations, recording every call. */
export function serveTalk(options: TalkServe = {}): ApiCall[] {
  const asked = { start: 0, turn: 0, reply: 0 };
  return fakeApi((call) => {
    if (call.method === "GET" && call.url === "/api/v1/home") {
      return Response.json(options.home ?? homeView({ kind: "ready", streak: COUNT }));
    }
    if (call.method === "GET" && /^\/api\/v1\/talks\/[^/]+$/u.test(call.url)) {
      const talkId = decodeURIComponent(call.url.split("/").at(-1) ?? "");
      return options.read?.(talkId) ?? refusal(404, "ERR_TALK_NOT_FOUND");
    }
    if (call.method !== "POST") return undefined;
    if (call.url === "/api/v1/talks") {
      const { talkId } = call.body as { talkId: string };
      asked.start += 1;
      return options.start?.(talkId, asked.start - 1) ?? Response.json(opened(talkId));
    }
    if (call.url.endsWith("/turns")) {
      const body = call.body as { turn: number; english: string | null };
      asked.turn += 1;
      return (
        options.turn?.(body, asked.turn - 1) ??
        Response.json(turnResult("fine", body.turn))
      );
    }
    if (call.url.endsWith("/reply")) {
      asked.reply += 1;
      return options.reply?.(asked.reply - 1) ?? refusal(503, "ERR_MODEL_UNAVAILABLE");
    }
    if (call.url.endsWith("/recital"))
      return options.recital?.() ?? new Response(null, { status: 204 });
    if (call.url.endsWith("/end"))
      return options.end?.() ?? Response.json({ kept: true });
    return undefined;
  });
}

/** The bodies of every POST to a URL matching `pattern`, in order. */
export function posted(calls: readonly ApiCall[], pattern: RegExp): unknown[] {
  return calls
    .filter((call) => call.method === "POST" && pattern.test(call.url))
    .map((call) => call.body);
}

export function press(name: string): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

export function write(field: string, text: string): void {
  fireEvent.change(screen.getByRole("textbox", { name: field }), {
    target: { value: text },
  });
}

/** Presses 「始める」 and lets the scene arrive. */
export async function begin(): Promise<void> {
  press(ja.Talk.start.go);
  await settle();
  await settle(16);
}

/** Sends the Japanese, then the English — or gives up on it with `null`. */
export async function say(japanese: string, english: string | null): Promise<void> {
  write(ja.Talk.step.japanese, japanese);
  press(ja.Talk.step.send);
  await settle();
  if (english === null) {
    press(ja.Talk.step.giveUp);
  } else {
    write(ja.Talk.step.english, english);
    press(ja.Talk.step.send);
  }
  await settle();
  await settle(16);
}

/** This browser's only resume key, exercised through localStorage rather than a stub. */
export function savedTalk(talkId: string | null): void {
  if (talkId === null) localStorage.removeItem(TALK_STORAGE_KEY);
  else localStorage.setItem(TALK_STORAGE_KEY, talkId);
}

/** A public read holding `count` corrected turns, including a give-up on turn 2. */
export function talkView(talkId: string, count = 3): TalkView {
  return {
    ...opened(talkId),
    status: "open",
    turns: Array.from({ length: count }, (_, index) => ({
      turn: index + 1,
      japanese: `日本語-${String(index + 1)}`,
      english: index === 1 ? null : `english-${String(index + 1)}`,
      judgment: turnResult("corrected", index + 1).judgment,
      reply: `reply-${String(index + 1)}`,
      closing: index + 1 === 6,
    })),
  };
}
