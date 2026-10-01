import { describe, expect, it } from "vitest";

import {
  decideEnd,
  decideRecital,
  decideReply,
  decideTurn,
  keepTurn,
  liveTalk,
  openTalk,
  sceneKindOf,
  seededRandom,
  type Talk,
  type TurnCommand,
} from "@instant-composition/domain";

import { makeTalk, makeTurn, without } from "./application-fixtures";

// The talk's pure rules: when a talk is there at all, which turn comes next,
// what a turn keeps, and how a talk ends.

/** 2026-09-22T03:00:00Z. */
const NOW = 1_790_046_000_000;
const MODEL = makeTalk().model;

const SEND: TurnCommand = {
  turn: 1,
  japanese: "先週引っ越してきました。",
  english: "I moved here last week.",
};

/** A talk holding turns 1 to `count`, each answered. */
function talkWith(count: number, overrides: Partial<Talk> = {}): Talk {
  return makeTalk({
    turns: Array.from({ length: count }, (_, index) =>
      makeTurn({ n: index + 1, reply: `Reply ${String(index + 1)}.` }),
    ),
    ...overrides,
  });
}

describe("liveTalk", () => {
  it("reads a talk before its expiry as it is", () => {
    const talk = makeTalk({ expiresAt: 1_790_046_001 });

    expect(liveTalk(talk, NOW)).toBe(talk);
  });

  it.each([
    ["at", 1_790_046_000],
    ["after", 1_790_045_999],
  ])("reads a talk %s its expiry as absent", (_, expiresAt) => {
    expect(liveTalk(makeTalk({ expiresAt }), NOW)).toBeUndefined();
  });

  it("never lapses a talk that no longer expires", () => {
    const kept = without(makeTalk({ status: "finished" }), "expiresAt");

    expect(liveTalk(kept, Number.MAX_SAFE_INTEGER)).toBe(kept);
  });

  it("reads no talk as no talk", () => {
    expect(liveTalk(undefined, NOW)).toBeUndefined();
  });
});

describe("sceneKindOf", () => {
  it.each([
    [0, "self"],
    [0.66, "self"],
    [0.67, "errand"],
    [0.99, "errand"],
  ])("draws %s as %s", (drawn, kind) => {
    expect(sceneKindOf(() => drawn)).toBe(kind);
  });

  it("makes about two scenes in three about the learner over many talk ids", () => {
    const kinds = Array.from({ length: 3_000 }, (_, index) =>
      sceneKindOf(seededRandom(`talk:t-${String(index)}`)),
    );
    const share = kinds.filter((kind) => kind === "self").length / kinds.length;

    expect(share).toBeGreaterThan(0.62);
    expect(share).toBeLessThan(0.71);
  });
});

describe("openTalk", () => {
  it("starts open, holding no turn, expiring one day later in epoch seconds", () => {
    const { scene, opening } = makeTalk();

    expect(
      openTalk({ id: "t9", now: NOW, scene, opening, model: MODEL }),
    ).toStrictEqual({
      id: "t9",
      status: "open",
      startedAt: NOW,
      expiresAt: 1_790_132_400,
      scene,
      opening,
      turns: [],
      model: MODEL,
    });
  });
});

describe("decideTurn", () => {
  it("answers ERR_TALK_NOT_FOUND for no talk", () => {
    expect(decideTurn(undefined, SEND)).toStrictEqual({
      ok: false,
      error: { code: "ERR_TALK_NOT_FOUND" },
    });
  });

  it.each([
    ["turn 0", { turn: 0 }],
    ["turn 7", { turn: 7 }],
    ["a fractional turn", { turn: 1.5 }],
    ["an empty Japanese", { japanese: "" }],
    ["a blank Japanese", { japanese: "   " }],
    ["a Japanese of 301 characters", { japanese: "あ".repeat(301) }],
    ["an empty English", { english: "" }],
    ["an English of 301 characters", { english: "a".repeat(301) }],
    ["an English holding hiragana", { english: "I moved ここ last week." }],
    ["an English holding katakana", { english: "I like ラーメン." }],
    ["an English holding kanji", { english: "I moved here 先週." }],
  ])("answers ERR_BAD_REQUEST for %s", (_, change) => {
    expect(decideTurn(makeTalk(), { ...SEND, ...change })).toStrictEqual({
      ok: false,
      error: { code: "ERR_BAD_REQUEST" },
    });
  });

  it.each([
    ["300 characters of Japanese", { japanese: "あ".repeat(300) }],
    ["300 emoji as 300 characters", { english: "🙂".repeat(300) }],
    ["a give-up", { english: null }],
  ])("takes %s", (_, change) => {
    expect(decideTurn(makeTalk(), { ...SEND, ...change }).ok).toBe(true);
  });

  it("takes turn 1 as the answer to the opening line", () => {
    const talk = makeTalk();

    expect(decideTurn(talk, SEND)).toStrictEqual({
      ok: true,
      value: {
        kind: "next",
        talk,
        n: 1,
        partnerLine: "Hi! Are you new around here?",
        closing: false,
      },
    });
  });

  it("takes the next turn as the answer to the previous reply", () => {
    const decided = decideTurn(talkWith(2), { ...SEND, turn: 3 });

    expect(decided.ok && decided.value).toMatchObject({
      kind: "next",
      n: 3,
      partnerLine: "Reply 2.",
      closing: false,
    });
  });

  it("makes turn 6's reply the one that closes", () => {
    const decided = decideTurn(talkWith(5), { ...SEND, turn: 6 });

    expect(decided.ok && decided.value).toMatchObject({ kind: "next", closing: true });
  });

  it("answers a kept turn as it was kept, even once the talk has finished", () => {
    const talk = talkWith(6, { status: "finished" });

    expect(decideTurn(talk, { ...SEND, turn: 2 })).toStrictEqual({
      ok: true,
      value: { kind: "kept", turn: talk.turns[1] },
    });
  });

  it.each([
    ["turn 3 after turn 1", talkWith(1), 3],
    [
      "turn 2 while turn 1 has no reply",
      makeTalk({ turns: [without(makeTurn(), "reply")] }),
      2,
    ],
  ])("answers ERR_CONFLICT for %s", (_, talk, turn) => {
    expect(decideTurn(talk, { ...SEND, turn })).toStrictEqual({
      ok: false,
      error: { code: "ERR_CONFLICT" },
    });
  });

  it.each(["finished", "ended", "discarded"] as const)(
    "answers ERR_TALK_CLOSED for a new turn on a %s talk",
    (status) => {
      expect(decideTurn(talkWith(1, { status }), { ...SEND, turn: 2 })).toStrictEqual({
        ok: false,
        error: { code: "ERR_TALK_CLOSED" },
      });
    },
  );

  it("answers ERR_TALK_CLOSED for a turn past the last on a finished talk", () => {
    expect(
      decideTurn(talkWith(6, { status: "finished" }), { ...SEND, turn: 7 }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_TALK_CLOSED" } });
  });
});

describe("keepTurn", () => {
  const next = (talk: Talk, command: TurnCommand) => {
    const decided = decideTurn(talk, command);
    if (!decided.ok || decided.value.kind !== "next") {
      throw new Error("The case needs a next turn.");
    }
    return decided.value;
  };
  const CORRECTED = {
    verdict: "corrected",
    modelAnswer: "I just moved here.",
    point: "「引っ越してきた」→ just moved here",
  } as const;

  it("keeps the turn with the judgment and the reply", () => {
    const kept = keepTurn(
      next(makeTalk(), SEND),
      SEND,
      { teacher: CORRECTED, reply: "Oh, welcome!" },
      NOW,
    );

    expect(kept.turn).toStrictEqual({
      n: 1,
      partnerLine: "Hi! Are you new around here?",
      japanese: SEND.japanese,
      english: SEND.english,
      judgment: CORRECTED,
      reply: "Oh, welcome!",
    });
    expect(kept.talk).toStrictEqual({ ...makeTalk(), turns: [kept.turn] });
  });

  it("keeps a turn whose teacher answered nothing as failed, with no reply when the partner did not answer", () => {
    const kept = keepTurn(
      next(makeTalk(), SEND),
      SEND,
      { teacher: undefined, reply: undefined },
      NOW,
    );

    expect(kept.turn.judgment).toStrictEqual({
      verdict: "failed",
      modelAnswer: "",
      point: "",
    });
    expect(kept.turn).not.toHaveProperty("reply");
  });

  it("shows nothing beside a fine English", () => {
    const kept = keepTurn(
      next(makeTalk(), SEND),
      SEND,
      { teacher: { ...CORRECTED, verdict: "fine" }, reply: "Nice." },
      NOW,
    );

    expect(kept.turn.judgment).toStrictEqual({
      verdict: "fine",
      modelAnswer: "",
      point: "",
    });
  });

  it("judges a give-up corrected even when the teacher said fine", () => {
    const gaveUp = { ...SEND, english: null };

    const kept = keepTurn(
      next(makeTalk(), gaveUp),
      gaveUp,
      { teacher: { ...CORRECTED, verdict: "fine" }, reply: "Nice." },
      NOW,
    );

    expect(kept.turn.english).toBeNull();
    expect(kept.turn.judgment).toStrictEqual(CORRECTED);
  });

  it("finishes the talk on turn 6, kept for good with no expiry", () => {
    const sixth = { ...SEND, turn: 6 };

    const kept = keepTurn(
      next(talkWith(5), sixth),
      sixth,
      { teacher: CORRECTED, reply: "Well, I'd better go. See you!" },
      NOW,
    );

    expect(kept.talk.status).toBe("finished");
    expect(kept.talk.endedAt).toBe(NOW);
    expect(kept.talk).not.toHaveProperty("expiresAt");
    expect(kept.talk.turns.map((turn) => turn.n)).toStrictEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("decideReply", () => {
  it("answers ERR_TALK_NOT_FOUND for no talk", () => {
    expect(decideReply(undefined)).toStrictEqual({
      ok: false,
      error: { code: "ERR_TALK_NOT_FOUND" },
    });
  });

  it("answers a kept reply, closing on turn 6", () => {
    expect(decideReply(talkWith(6, { status: "finished" }))).toStrictEqual({
      ok: true,
      value: { kind: "kept", line: "Reply 6.", closing: true },
    });
  });

  it.each(["open", "finished"] as const)(
    "asks again for the latest turn's missing reply on a %s talk",
    (status) => {
      const turn = without(makeTurn(), "reply");
      const talk = makeTalk({ status, turns: [turn] });

      expect(decideReply(talk)).toStrictEqual({
        ok: true,
        value: { kind: "ask", talk, turn },
      });
    },
  );

  it("answers ERR_CONFLICT before any turn", () => {
    expect(decideReply(makeTalk())).toStrictEqual({
      ok: false,
      error: { code: "ERR_CONFLICT" },
    });
  });

  it.each(["ended", "discarded"] as const)(
    "answers ERR_TALK_CLOSED for a missing reply on a %s talk",
    (status) => {
      const talk = makeTalk({ status, turns: [without(makeTurn(), "reply")] });

      expect(decideReply(talk)).toStrictEqual({
        ok: false,
        error: { code: "ERR_TALK_CLOSED" },
      });
    },
  );
});

describe("decideRecital", () => {
  it("keeps the reveal count on the turn", () => {
    const decided = decideRecital(talkWith(2), { turn: 2, revealCount: 3 });

    expect(
      decided.ok && decided.value.turns.map((turn) => turn.revealCount),
    ).toStrictEqual([undefined, 3]);
  });

  it("answers the same talk when the count is already kept", () => {
    const talk = makeTalk({ turns: [makeTurn({ revealCount: 0 })] });

    expect(decideRecital(talk, { turn: 1, revealCount: 0 })).toStrictEqual({
      ok: true,
      value: talk,
    });
  });

  it.each([
    ["no talk", undefined, 1, 0, "ERR_TALK_NOT_FOUND"],
    ["a negative count", talkWith(1), 1, -1, "ERR_BAD_REQUEST"],
    ["a fractional count", talkWith(1), 1, 0.5, "ERR_BAD_REQUEST"],
    ["a turn not kept yet", talkWith(1), 2, 0, "ERR_CONFLICT"],
  ])("answers %s with its code", (_, talk, turn, revealCount, code) => {
    expect(decideRecital(talk, { turn, revealCount })).toStrictEqual({
      ok: false,
      error: { code },
    });
  });
});

describe("decideEnd", () => {
  it("ends a talk holding a turn: kept, ended, no longer expiring", () => {
    const decided = decideEnd(talkWith(1), NOW);

    expect(decided).toStrictEqual({
      ok: true,
      value: {
        kept: true,
        talk: {
          ...without(talkWith(1), "expiresAt"),
          status: "ended",
          endedAt: NOW,
        },
      },
    });
  });

  it("discards a talk holding no turn, left to expire", () => {
    expect(decideEnd(makeTalk(), NOW)).toStrictEqual({
      ok: true,
      value: {
        kept: false,
        talk: { ...makeTalk(), status: "discarded", endedAt: NOW },
      },
    });
  });

  it.each([
    ["ended", true],
    ["finished", true],
    ["discarded", false],
  ] as const)("answers a %s talk the same kept, unchanged", (status, kept) => {
    const talk = makeTalk({ status });

    expect(decideEnd(talk, NOW)).toStrictEqual({ ok: true, value: { kept, talk } });
  });

  it("answers ERR_TALK_NOT_FOUND for no talk", () => {
    expect(decideEnd(undefined, NOW)).toStrictEqual({
      ok: false,
      error: { code: "ERR_TALK_NOT_FOUND" },
    });
  });
});
