import { describe, expect, it } from "vitest";

import {
  decideAddCards,
  decideCandidates,
  personalCardId,
  pickCandidates,
  type AddCardsState,
  type CardCandidate,
  type Talk,
} from "@instant-composition/domain";

import { makeTalk, makeTurn, makeVocabProgress } from "./application-fixtures";

// A talk's card candidates as pure rules: when the one call is made, which of
// its answers are kept, and what adding a pick writes.

const FINE = { verdict: "fine", modelAnswer: "", point: "" } as const;
const FAILED = { verdict: "failed", modelAnswer: "", point: "" } as const;

/** A talk ended after five turns: 2 and 5 corrected (5 a give-up), the rest not. */
const ENDED: Talk = makeTalk({
  status: "ended",
  turns: [
    makeTurn({ n: 1, judgment: FINE }),
    makeTurn({ n: 2 }),
    makeTurn({ n: 3, judgment: FAILED }),
    makeTurn({ n: 4, judgment: FINE }),
    makeTurn({ n: 5, english: null }),
  ],
});

const CATCH_UP: CardCandidate = {
  turn: 2,
  category: "idiom",
  headword: "catch up",
  definition: "To talk about what has happened since you last met.",
  example: "Let's {{catch}} {{up}} over coffee soon.",
  example2: "We caught up at the station.",
  meaning: "近況を話す",
};

const SWAMPED: CardCandidate = {
  turn: 5,
  category: "word",
  headword: "swamped",
  definition: "Having too much work to do.",
  example: "I'm {{swamped}} with work this week.",
  example2: "She was swamped after the holidays.",
  meaning: "忙しくて手一杯",
};

const OFFERED: Talk = {
  ...ENDED,
  cards: { promptVersion: "talk-cards@1", candidates: [CATCH_UP, SWAMPED], added: [] },
};

describe("decideCandidates", () => {
  it("asks once for a kept talk's corrected turns, give-ups included", () => {
    const decided = decideCandidates(ENDED);

    expect(decided.ok && decided.value.kind).toBe("ask");
    expect(
      decided.ok && decided.value.kind === "ask" && decided.value.turns.map((t) => t.n),
    ).toStrictEqual([2, 5]);
  });

  it("answers the kept candidates, and none for a talk with no corrected turn", () => {
    expect(decideCandidates(OFFERED)).toStrictEqual({
      ok: true,
      value: { kind: "kept", cards: OFFERED.cards },
    });
    const noCorrection = makeTalk({
      status: "finished",
      turns: [makeTurn({ judgment: FINE })],
    });
    expect(decideCandidates(noCorrection)).toStrictEqual({
      ok: true,
      value: { kind: "none" },
    });
    expect(decideCandidates(makeTalk({ status: "discarded" }))).toStrictEqual({
      ok: true,
      value: { kind: "none" },
    });
  });

  it("refuses an open talk with ERR_CONFLICT and an absent one with ERR_TALK_NOT_FOUND", () => {
    expect(decideCandidates(makeTalk({ turns: [makeTurn()] }))).toStrictEqual({
      ok: false,
      error: { code: "ERR_CONFLICT" },
    });
    expect(decideCandidates(undefined)).toStrictEqual({
      ok: false,
      error: { code: "ERR_TALK_NOT_FOUND" },
    });
  });
});

describe("pickCandidates", () => {
  const turns = ENDED.turns.filter((turn) => turn.judgment.verdict === "corrected");

  it("keeps one candidate per corrected turn, the first", () => {
    expect(
      pickCandidates(turns, [CATCH_UP, { ...CATCH_UP, headword: "meet up" }, SWAMPED]),
    ).toStrictEqual([CATCH_UP, SWAMPED]);
  });

  it("drops a candidate from a turn that was not corrected, or whose text breaks a card rule", () => {
    expect(
      pickCandidates(turns, [
        { ...CATCH_UP, turn: 1 },
        { ...CATCH_UP, example: "Let's {{catch up}} soon." },
        SWAMPED,
      ]),
    ).toStrictEqual([SWAMPED]);
  });

  it("keeps at most six", () => {
    const six = Array.from({ length: 7 }, (_, index) =>
      makeTurn({ n: index + 1, english: null }),
    );
    const answered = six.map((turn) => ({ ...SWAMPED, turn: turn.n }));

    expect(pickCandidates(six, answered)).toHaveLength(6);
  });
});

describe("personalCardId", () => {
  it("names the same candidate's card the same, and another candidate's apart", () => {
    const id = personalCardId("t1", 0);

    expect(id).toMatch(/^p_[0-9a-z]{12}$/);
    expect(personalCardId("t1", 0)).toBe(id);
    expect(new Set([id, personalCardId("t1", 1), personalCardId("t2", 0)]).size).toBe(
      3,
    );
  });
});

describe("decideAddCards", () => {
  const STATE: AddCardsState = {
    talk: OFFERED,
    known: new Map(),
    progress: new Map(),
    target: "en",
    l1: "ja",
    level: 4,
    now: 9_000,
  };

  it("makes a candidate no card holds a personal card, new and from the talk", () => {
    const decided = decideAddCards(STATE, [0]);
    const id = personalCardId("t1", 0);

    expect(decided).toStrictEqual({
      ok: true,
      value: {
        talk: {
          ...OFFERED,
          cards: { ...OFFERED.cards, added: [{ index: 0, cardId: id }] },
        },
        offered: { ...OFFERED.cards, added: [{ index: 0, cardId: id }] },
        progress: [
          {
            cardId: id,
            source: { kind: "talk", talkId: "t1", turn: 2 },
            state: null,
            firstDay: null,
          },
        ],
        cards: [
          {
            id,
            target: "en",
            l1: "ja",
            level: 4,
            category: "idiom",
            headword: "catch up",
            definition: CATCH_UP.definition,
            example: CATCH_UP.example,
            example2: CATCH_UP.example2,
            meaning: "近況を話す",
            source: { kind: "talk", talkId: "t1", turn: 2 },
            createdAt: 9_000,
          },
        ],
      },
    });
  });

  it("marks a matched card in learning as from the talk, its schedule kept", () => {
    const learning = makeVocabProgress({ cardId: "v_swamped" });
    const decided = decideAddCards(
      {
        ...STATE,
        known: new Map([["swamped", "v_swamped"]]),
        progress: new Map([["v_swamped", learning]]),
      },
      [1],
    );

    expect(decided.ok && decided.value.cards).toStrictEqual([]);
    expect(decided.ok && decided.value.progress).toStrictEqual([
      { ...learning, source: { kind: "talk", talkId: "t1", turn: 5 } },
    ]);
  });

  it("adds a candidate once however often it is named", () => {
    const first = decideAddCards(STATE, [0, 0]);
    const talk = first.ok ? first.value.talk : OFFERED;
    const again = decideAddCards({ ...STATE, talk }, [0]);

    expect(first.ok && first.value.offered.added).toHaveLength(1);
    expect(again).toStrictEqual({
      ok: true,
      value: { talk, offered: talk.cards, progress: [], cards: [] },
    });
  });

  it("makes one card of two candidates with the same headword", () => {
    const twice: Talk = {
      ...OFFERED,
      cards: {
        promptVersion: "talk-cards@1",
        candidates: [SWAMPED, { ...SWAMPED, turn: 2, headword: "Swamped" }],
        added: [],
      },
    };
    const decided = decideAddCards({ ...STATE, talk: twice }, [0, 1]);

    expect(decided.ok && decided.value.cards).toHaveLength(1);
    expect(
      decided.ok && decided.value.offered.added.map((a) => a.cardId),
    ).toStrictEqual([personalCardId("t1", 0), personalCardId("t1", 0)]);
  });

  it.each([
    ["an index past the list", OFFERED, [2], "ERR_BAD_REQUEST"],
    ["a negative index", OFFERED, [-1], "ERR_BAD_REQUEST"],
    ["a talk with no candidates yet", ENDED, [0], "ERR_CONFLICT"],
    ["no talk", undefined, [0], "ERR_TALK_NOT_FOUND"],
  ] as const)("refuses %s", (_, talk, indexes, code) => {
    expect(decideAddCards({ ...STATE, talk }, indexes)).toStrictEqual({
      ok: false,
      error: { code },
    });
  });
});
