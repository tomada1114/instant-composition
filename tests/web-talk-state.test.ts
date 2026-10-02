import { describe, expect, it } from "vitest";

import {
  TALK_IDLE,
  resumedTalk,
  type TalkView,
  talkReducer,
  type PartnerReply,
  type TalkEvent,
  type TalkOpened,
  type TalkState,
  type TurnResult,
  type Verdict,
} from "@instant-composition/web";

// The talk screen's reducer, driven event by event: the steps a turn passes,
// and the answers that arrive too late — for a step already left, a talk
// already ended, or another talk — which change nothing.

const ID = "talk-1";

function opened(talkId: string): TalkOpened {
  return {
    talkId,
    scene: {
      partner: "店員",
      place: "カフェ",
      relation: "顔なじみ",
      description: "カフェ。",
    },
    opening: "Hi there.",
  };
}

function replyTo(n: number): PartnerReply {
  return { line: `reply-${String(n)}`, closing: n === 6 };
}

function turnResult(
  verdict: Verdict,
  n: number,
  reply: PartnerReply | null = replyTo(n),
): TurnResult {
  return {
    judgment: { verdict, modelAnswer: "A model answer.", point: "要点" },
    reply,
  };
}

function run(...events: TalkEvent[]): TalkState {
  return events.reduce(talkReducer, TALK_IDLE);
}

const OPEN: TalkEvent[] = [{ type: "start" }, { type: "opened", opened: opened(ID) }];
const SENT: TalkEvent[] = [
  ...OPEN,
  { type: "japanese", text: "仕事が詰まってて" },
  { type: "english", text: "I was busy." },
];

function step(state: TalkState): string {
  return state.kind === "talk" ? state.talk.step : state.kind;
}

describe("the talk reducer", () => {
  it("prepares, then opens on the scene with turn 1 asking for the Japanese", () => {
    expect(step(run({ type: "start" }))).toBe("preparing");
    const state = run(...OPEN);
    expect(state.kind === "talk" ? state.talk.turns : []).toStrictEqual([
      { n: 1, partnerLine: opened(ID).opening, revealCount: 0 },
    ]);
    expect(step(state)).toBe("japanese");
  });

  it.each<[string, TalkEvent[], string]>([
    [
      "a scene that arrives after nothing was asked",
      [{ type: "opened", opened: opened(ID) }],
      "idle",
    ],
    [
      "a failed start that arrives after nothing was asked",
      [{ type: "startFailed" }],
      "idle",
    ],
    [
      "English before the Japanese",
      [...OPEN, { type: "english", text: "Hi." }],
      "japanese",
    ],
    [
      "a second Japanese",
      [...SENT.slice(0, 3), { type: "japanese", text: "また" }],
      "english",
    ],
    [
      "a judgment for another talk",
      [...SENT, { type: "answered", talkId: "other", result: turnResult("fine", 1) }],
      "teacher",
    ],
    [
      "a judgment before anything was sent",
      [...OPEN, { type: "answered", talkId: ID, result: turnResult("fine", 1) }],
      "japanese",
    ],
    [
      "a failed turn before anything was sent",
      [...OPEN, { type: "turnFailed", talkId: ID }],
      "japanese",
    ],
    [
      "hiding a fine turn",
      [
        ...SENT,
        { type: "answered", talkId: ID, result: turnResult("fine", 1) },
        { type: "hide" },
      ],
      "fine",
    ],
    [
      "looking again before hiding",
      [
        ...SENT,
        { type: "answered", talkId: ID, result: turnResult("corrected", 1) },
        { type: "lookAgain" },
      ],
      "model",
    ],
    [
      "言えた before hiding",
      [
        ...SENT,
        { type: "answered", talkId: ID, result: turnResult("corrected", 1) },
        { type: "said" },
      ],
      "model",
    ],
    [
      "a ○ shown twice",
      [
        ...SENT,
        { type: "answered", talkId: ID, result: turnResult("fine", 1) },
        { type: "shown", talkId: ID },
        { type: "shown", talkId: ID },
      ],
      "japanese",
    ],
    [
      "a retry with nothing to retry",
      [...OPEN, { type: "retrying", talkId: ID }],
      "japanese",
    ],
    [
      "a reply nobody asked for",
      [...OPEN, { type: "replied", talkId: ID, reply: replyTo(1) }],
      "japanese",
    ],
    [
      "a failed reply nobody asked for",
      [...OPEN, { type: "replyFailed", talkId: ID }],
      "japanese",
    ],
    [
      "a judgment after the talk ended",
      [
        ...SENT,
        { type: "end" },
        { type: "answered", talkId: ID, result: turnResult("fine", 1) },
      ],
      "ended",
    ],
    [
      "a gone for another talk",
      [...SENT, { type: "gone", talkId: "other" }],
      "teacher",
    ],
    [
      "a gone before anything was sent",
      [...OPEN, { type: "gone", talkId: ID }],
      "japanese",
    ],
    [
      "a gone after the talk ended",
      [...SENT, { type: "end" }, { type: "gone", talkId: ID }],
      "ended",
    ],
  ])("changes nothing for %s", (_, events, expected) => {
    const before = run(...events.slice(0, -1));
    const last = events.at(-1);
    if (last === undefined) throw new Error("Each row ends on the event under test.");
    const after = talkReducer(before, last);
    expect(step(after)).toBe(expected);
    expect(after).toBe(before);
  });

  it("ends after the sixth turn even when its reply does not say it closes", () => {
    let state = run(...OPEN);
    for (let n = 1; n <= 6; n += 1) {
      state = [
        { type: "japanese", text: "日本語" },
        { type: "english", text: "English." },
        {
          type: "answered",
          talkId: ID,
          result: turnResult("failed", n, {
            line: `reply-${String(n)}`,
            closing: false,
          }),
        },
      ].reduce<TalkState>(
        (last, event) => talkReducer(last, event as TalkEvent),
        state,
      );
    }
    expect(step(state)).toBe("ended");
  });

  it("ends a talk the server no longer takes while it waits for the teacher", () => {
    expect(step(run(...SENT, { type: "gone", talkId: ID }))).toBe("ended");
  });

  it("ends a talk the server no longer takes while it waits for the partner, keeping its turns", () => {
    const waiting = run(
      ...SENT,
      { type: "answered", talkId: ID, result: turnResult("fine", 1, null) },
      { type: "shown", talkId: ID },
      { type: "retrying", talkId: ID },
    );
    expect(step(waiting)).toBe("partner");
    const after = talkReducer(waiting, { type: "gone", talkId: ID });
    expect(step(after)).toBe("ended");
    if (after.kind !== "talk" || waiting.kind !== "talk")
      throw new Error("Both are talks.");
    expect(after.talk.turns).toBe(waiting.talk.turns);
  });

  it("restarts from W2's preparing when a new talk is asked for", () => {
    expect(step(run(...SENT, { type: "end" }, { type: "start" }))).toBe("preparing");
  });
});

describe("restoring kept turns", () => {
  const view = (turns: TalkView["turns"]): TalkView => ({
    ...opened(ID),
    status: "open",
    turns,
  });
  it("starts an empty open talk at its opening", () => {
    const talk = resumedTalk(view([]));
    expect(talk.step).toBe("japanese");
    expect(talk.turns).toStrictEqual([
      { n: 1, partnerLine: opened(ID).opening, revealCount: 0 },
    ]);
  });
  it.each(["fine", "corrected", "failed"] as const)(
    "skips an interrupted %s turn, keeping its judgment and give-up",
    (verdict) => {
      const judgment = turnResult(verdict, 1).judgment;
      const talk = resumedTalk(
        view([
          {
            turn: 1,
            japanese: "日本語",
            english: null,
            judgment,
            reply: "Reply.",
            closing: false,
          },
        ]),
      );
      expect(talk.step).toBe("japanese");
      expect(talk.turns).toHaveLength(2);
      expect(talk.turns[0]).toMatchObject({ english: null, judgment, revealCount: 0 });
      expect(talk.turns[1]).toMatchObject({ n: 2, partnerLine: "Reply." });
    },
  );
  it("waits to retry a missing reply and continues when it arrives", () => {
    const talk = resumedTalk(
      view([
        {
          turn: 1,
          japanese: "日本語",
          english: "English.",
          judgment: turnResult("corrected", 1).judgment,
          reply: null,
          closing: false,
        },
      ]),
    );
    expect(talk.step).toBe("replyFailed");
    const state: TalkState = { kind: "talk", talk };
    const retrying = talkReducer(state, { type: "retrying", talkId: ID });
    const replied = talkReducer(retrying, {
      type: "replied",
      talkId: ID,
      reply: replyTo(1),
    });
    expect(step(replied)).toBe("japanese");
  });
  it("shows the end when the kept reply closes", () => {
    const talk = resumedTalk(
      view([
        {
          turn: 6,
          japanese: "日本語",
          english: "English.",
          judgment: turnResult("fine", 6).judgment,
          reply: "Bye.",
          closing: true,
        },
      ]),
    );
    expect(talk).toMatchObject({ step: "ended", closed: true });
  });
  it("accepts a resume only while preparing, and missing returns to idle", () => {
    const talk = resumedTalk(view([]));
    const event: TalkEvent = { type: "resumed", talk };
    expect(talkReducer(TALK_IDLE, event)).toBe(TALK_IDLE);
    expect(talkReducer({ kind: "preparing" }, event)).toStrictEqual({
      kind: "talk",
      talk,
    });
    expect(talkReducer({ kind: "preparing" }, { type: "resumeMissing" })).toBe(
      TALK_IDLE,
    );
    const state = run(...OPEN);
    expect(talkReducer(state, event)).toBe(state);
    expect(talkReducer(state, { type: "resumeMissing" })).toBe(state);
  });
});
