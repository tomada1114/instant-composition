import { describe, expect, it } from "vitest";

import { MAX_REQUEST_BODY_BYTES } from "@instant-composition/api";
import { learnerId, type RoundPayload } from "@instant-composition/application";
import { addDays, isFast } from "@instant-composition/domain";
import {
  errorResponseSchema,
  MESSAGE_BY_CODE,
  ROUTES,
} from "@instant-composition/contracts";

import {
  batchFor,
  makeApi,
  startedPlacement,
  subjectAuthenticator,
  type ApiHarness,
} from "./api-harness";
import { NOON, unreadableCatalog } from "./application-harness";

// The app driven with `new Request(…)` over the in-memory store: each answer
// is checked against the contract's schema for it, and each refusal against
// the envelope and the status STATUS_BY_CODE gives its code.

/** The body `response` carries, checked against the contract's success schema for `operationId`. */
async function contracted(response: Response, operationId: string): Promise<unknown> {
  const entry = ROUTES.find((candidate) => candidate.operationId === operationId);
  expect(response.status).toBe(entry?.success.status);
  const body: unknown = await response.json();
  return entry?.success.body?.parse(body);
}

async function refusal(response: Response): Promise<[number, string]> {
  const body = errorResponseSchema.parse(await response.json());
  return [response.status, body.error.code];
}

async function finished(api: ApiHarness, roundId = "p1"): Promise<unknown> {
  const round = await startedPlacement(api, roundId);
  const response = await api.call(
    "POST",
    `/v1/rounds/${roundId}/finish`,
    batchFor(round),
  );
  return contracted(response, "finishRound");
}

describe("the queries", () => {
  it.each([
    ["getHome", "/v1/home"],
    ["getRecords", "/v1/records"],
    ["getSettings", "/v1/settings"],
    ["getHistory", "/v1/history"],
  ])("%s answers its view", async (operationId, path) => {
    const api = makeApi();
    await startedPlacement(api);
    const view = await contracted(await api.call("GET", path), operationId);
    expect(view).toBeTypeOf("object");
  });

  it("answers a finished round's summary by its id, the same one finishing answered", async () => {
    const api = makeApi();
    const summary = await finished(api);
    api.advance(3 * 86_400_000);
    const response = await api.call("GET", "/v1/rounds/p1/summary");
    expect(await contracted(response, "getRoundSummary")).toStrictEqual(summary);
  });

  it.each([
    ["an open round", "p1"],
    ["an id no round has", "p9"],
  ])("does not find the summary of %s", async (_, roundId) => {
    const api = makeApi();
    await startedPlacement(api);
    expect(
      await refusal(await api.call("GET", `/v1/rounds/${roundId}/summary`)),
    ).toStrictEqual([404, "ERR_ROUND_NOT_FOUND"]);
  });
});

describe("reading a round back", () => {
  it("resumes an earlier day's round a later start abandoned, with the answers it holds", async () => {
    const api = makeApi();
    await finished(api);
    api.advance(86_400_000);
    const started = (await contracted(
      await api.call("POST", "/v1/rounds", { roundId: "t1", kind: "today" }),
      "startRound",
    )) as RoundPayload;
    const held = batchFor(started)
      .answers.slice(0, 3)
      .map((answer, index) => ({
        ...answer,
        answeredAt: NOON + 86_400_000 + (3 - index) * 1_000,
      }));
    api.advance(10_000);
    await api.call("POST", "/v1/rounds/t1/answers", { answers: held });
    api.advance(86_400_000);
    await api.call("POST", "/v1/rounds", { roundId: "t2", kind: "today" });

    const response = await api.call("GET", "/v1/rounds/t1");

    const read = (await contracted(response, "getRound")) as RoundPayload;
    expect(read).toMatchObject({ id: "t1", day: started.day, deck: started.deck });
    expect(read.answered).toStrictEqual(
      held
        .map(({ id, cardId, pass, result, answeredAt }) => ({
          id,
          cardId,
          pass,
          result,
          grade: "good",
          timedOut: false,
          answeredAt,
        }))
        .reverse(),
    );
    const stored = await api.stores.forLearner(learnerId("learner-1")).round("t1");
    expect(stored?.value.abandonedAt).toBe(NOON + 2 * 86_400_000 + 10_000);
  });

  it("does not find a round there is no such id for", async () => {
    const api = makeApi();
    await startedPlacement(api);
    expect(await refusal(await api.call("GET", "/v1/rounds/p9"))).toStrictEqual([
      404,
      "ERR_ROUND_NOT_FOUND",
    ]);
  });

  it("answers 503 when the catalog cannot be read", async () => {
    const api = makeApi();
    await startedPlacement(api);
    const unreadable = makeApi({
      stores: api.stores,
      directory: api.directory,
      catalog: unreadableCatalog,
    });
    expect(await refusal(await unreadable.call("GET", "/v1/rounds/p1"))).toStrictEqual([
      503,
      "ERR_CONTENT_UNREADABLE",
    ]);
  });
});

describe("the commands", () => {
  it("records a batch whose answers carry no roundId, taking the round from the path", async () => {
    const api = makeApi();
    const round = await startedPlacement(api);
    const batch = batchFor(round);
    const recorded = await api.call("POST", "/v1/rounds/p1/answers", batch);
    expect(recorded.status).toBe(204);
    expect(await recorded.text()).toBe("");
    const again = await api.call("POST", "/v1/rounds/p1/answers", batch);
    expect(again.status).toBe(204);

    const reviews = await api.stores.forLearner(learnerId("learner-1")).reviewsOf("p1");
    expect(reviews.map((review) => review.id)).toStrictEqual(
      batch.answers.map((answer) => answer.id).sort(),
    );
  });

  it("logs the time a client says each answer was given, held to the server's", async () => {
    const api = makeApi();
    const round = await startedPlacement(api);
    api.advance(60_000);
    const [given, ahead] = batchFor(round).answers;
    if (given === undefined || ahead === undefined) throw new Error("No deck.");

    const recorded = await api.call("POST", "/v1/rounds/p1/answers", {
      answers: [
        { ...given, answeredAt: NOON + 30_000 },
        { ...ahead, answeredAt: NOON + 86_400_000 },
      ],
    });

    expect(recorded.status).toBe(204);
    const reviews = await api.stores.forLearner(learnerId("learner-1")).reviewsOf("p1");
    expect(reviews.map((review) => [review.id, review.answeredAt])).toStrictEqual([
      [given.id, NOON + 30_000],
      [ahead.id, NOON + 60_000],
    ]);
  });

  it("deals each card with the drill's fields alone, leaving the card's concepts off the wire", async () => {
    const api = makeApi();
    const round = await startedPlacement(api);
    const shapes = Object.values(round.cards).map((card) =>
      Object.keys(card).sort().join(" "),
    );
    expect(new Set(shapes)).toStrictEqual(
      new Set([
        "alternatives explanation id intervals isNew level limitMs paceMs prompt subtopic text topic words",
      ]),
    );
  });

  it("resumes the round a retried start made", async () => {
    const api = makeApi();
    const first = await startedPlacement(api);
    const retried = await api.call("POST", "/v1/rounds", {
      roundId: "p1",
      kind: "placement",
    });
    expect(await contracted(retried, "startRound")).toStrictEqual(first);
  });

  it("answers the kept summary when a round is finished twice", async () => {
    const api = makeApi();
    const summary = await finished(api);
    const again = await api.call("POST", "/v1/rounds/p1/finish", { answers: [] });
    expect(await contracted(again, "finishRound")).toStrictEqual(summary);
  });

  it("refuses answers for a round that is not there", async () => {
    const api = makeApi();
    await startedPlacement(api);
    expect(
      await refusal(await api.call("POST", "/v1/rounds/p9/answers", { answers: [] })),
    ).toStrictEqual([404, "ERR_ROUND_NOT_FOUND"]);
  });

  it("answers 503 when the catalog cannot be read", async () => {
    const api = makeApi({ catalog: unreadableCatalog });
    expect(
      await refusal(
        await api.call("POST", "/v1/rounds", { roundId: "p1", kind: "placement" }),
      ),
    ).toStrictEqual([503, "ERR_CONTENT_UNREADABLE"]);
  });
});

describe("the per-card time limit", () => {
  const limits = (round: RoundPayload) =>
    Object.values(round.cards).map((card) => card.limitMs);

  it("deals a new learner's round 30 seconds on every card, and says so in the settings", async () => {
    const api = makeApi();
    const round = await startedPlacement(api);
    expect(limits(round).length).toBeGreaterThan(0);
    expect(new Set(limits(round))).toStrictEqual(new Set([30_000]));
    const page = await contracted(await api.call("GET", "/v1/settings"), "getSettings");
    expect(page).toMatchObject({ settings: { limitSeconds: 30 } });
  });

  it("deals 45 seconds from the next round once the learner picks it, and holds the round under way to its own", async () => {
    const api = makeApi();
    const first = await startedPlacement(api);
    const saved = await api.call("PATCH", "/v1/settings", { limitSeconds: 45 });
    expect(await contracted(saved, "updateSettings")).toMatchObject({
      settings: { limitSeconds: 45 },
    });

    const resumed = await api.call("POST", "/v1/rounds", {
      roundId: "p1",
      kind: "placement",
    });
    expect(new Set(limits((await resumed.json()) as RoundPayload))).toStrictEqual(
      new Set([30_000]),
    );

    const next = await api.call("POST", "/v1/rounds", { roundId: "x1", kind: "extra" });
    const dealt = (await contracted(next, "startRound")) as RoundPayload;
    expect(limits(dealt).length).toBeGreaterThan(0);
    expect(new Set(limits(dealt))).toStrictEqual(new Set([45_000]));

    const [late] = first.deck;
    if (late === undefined) throw new Error("No deck.");
    const recorded = await api.call("POST", "/v1/rounds/p1/answers", {
      answers: [
        {
          id: "p1:f:late",
          cardId: late,
          pass: "first",
          result: "timeout",
          elapsedMs: 1,
        },
      ],
    });
    expect(recorded.status).toBe(204);
    const reviews = await api.stores.forLearner(learnerId("learner-1")).reviewsOf("p1");
    expect(reviews.map((review) => review.detail)).toMatchObject([
      { limitMs: 30_000, elapsedMs: 30_000 },
    ]);
  });

  it("judges fast against each card's length-derived pace, whatever limit was chosen", async () => {
    const api = makeApi();
    await startedPlacement(api);
    await api.call("PATCH", "/v1/settings", { limitSeconds: 60 });
    const started = await api.call("POST", "/v1/rounds", {
      roundId: "x1",
      kind: "extra",
    });
    const round = (await started.json()) as RoundPayload;
    const cards = Object.values(round.cards);
    // Every flip below lands within half the 60-second limit; only the pace tells them apart.
    const elapsed = (index: number, paceMs: number) => paceMs / 2 + (index % 2);
    expect(cards.every((card) => card.paceMs / 2 + 1 <= card.limitMs / 2)).toBe(true);

    await api.call("POST", "/v1/rounds/x1/answers", {
      answers: cards.map((card, index) => ({
        id: `x1:f:${card.id}`,
        cardId: card.id,
        pass: "first",
        result: "ok",
        elapsedMs: elapsed(index, card.paceMs),
      })),
    });

    const expected = new Map(cards.map((card, index) => [card.id, index % 2 === 0]));
    const reviews = await api.stores.forLearner(learnerId("learner-1")).reviewsOf("x1");
    expect(reviews).toHaveLength(cards.length);
    for (const review of reviews) {
      const { elapsedMs, paceMs, limitMs } = review.detail;
      expect(limitMs).toBe(60_000);
      expect([review.item.id, isFast(elapsedMs, paceMs ?? limitMs)]).toStrictEqual([
        review.item.id,
        expected.get(review.item.id),
      ]);
    }
  });
});

describe("the level picked by hand", () => {
  it("fixes the level a new learner picks, shows it in the settings and sends no one to a placement", async () => {
    const api = makeApi();
    await api.call("PATCH", "/v1/settings", { topics: ["work"] });
    const chosen = await api.call("PATCH", "/v1/level", { mode: "manual", level: 5 });
    expect(await contracted(chosen, "updateLevel")).toStrictEqual({
      mode: "manual",
      level: 5,
      toeic: "500",
    });

    const page = await contracted(await api.call("GET", "/v1/settings"), "getSettings");
    expect(page).toMatchObject({
      toeic: "500",
      difficulty: { mode: "manual", level: 5, toeic: "500" },
    });
    expect((page as { levels: unknown[] }).levels).toHaveLength(10);
    const home = await contracted(await api.call("GET", "/v1/home"), "getHome");
    expect(home).toMatchObject({ state: { kind: "ready" } });
    const records = await contracted(
      await api.call("GET", "/v1/records"),
      "getRecords",
    );
    expect(records).toMatchObject({
      toeic: "500",
      levelMode: "manual",
      suggestedToeic: null,
    });

    const released = await api.call("PATCH", "/v1/level", { mode: "auto" });
    expect(await contracted(released, "updateLevel")).toStrictEqual({
      mode: "auto",
      level: 5,
      toeic: "500",
    });
  });

  it.each([
    ["a level off the scale", { mode: "manual", level: 11 }],
    ["a level of zero", { mode: "manual", level: 0 }],
    ["manual with no level", { mode: "manual" }],
    ["a mode that does not exist", { mode: "goal", level: 5 }],
  ])("answers 400 ERR_BAD_REQUEST for %s", async (_, body) => {
    expect(
      await refusal(await makeApi().call("PATCH", "/v1/level", body)),
    ).toStrictEqual([400, "ERR_BAD_REQUEST"]);
  });
});

describe("the grade keys", () => {
  const DEFAULT = { ok: "ArrowRight", ng: "ArrowLeft", hard: "Digit2" };

  it("reads → and ← for a learner who never chose a pair, in the settings and the home view", async () => {
    const api = makeApi();
    const page = await contracted(await api.call("GET", "/v1/settings"), "getSettings");
    const home = await contracted(await api.call("GET", "/v1/home"), "getHome");
    expect(page).toMatchObject({ settings: { gradeKeys: DEFAULT } });
    expect(home).toMatchObject({ gradeKeys: DEFAULT });
  });

  it("saves a pair the learner sets, and reads it back from the settings and the home view", async () => {
    const api = makeApi();
    await api.call("PATCH", "/v1/settings", { topics: ["work"] });
    const gradeKeys = { ok: "KeyL", ng: "Digit1" };
    const saved = await api.call("PATCH", "/v1/settings", { gradeKeys });
    expect(await contracted(saved, "updateSettings")).toMatchObject({
      settings: { gradeKeys },
    });
    const page = await contracted(await api.call("GET", "/v1/settings"), "getSettings");
    const home = await contracted(await api.call("GET", "/v1/home"), "getHome");
    expect(page).toMatchObject({ settings: { gradeKeys } });
    expect(home).toMatchObject({ gradeKeys });
  });

  it("saves a pair an older client sets and reads hard on the first of 2, S and ↓ it leaves free", async () => {
    const api = makeApi();
    await api.call("PATCH", "/v1/settings", { topics: ["work"] });
    const saved = await api.call("PATCH", "/v1/settings", {
      gradeKeys: { ok: "KeyK", ng: "KeyJ" },
    });
    const gradeKeys = { ok: "KeyK", ng: "KeyJ", hard: "Digit2" };
    expect(await contracted(saved, "updateSettings")).toMatchObject({
      settings: { gradeKeys },
    });
    const home = await contracted(await api.call("GET", "/v1/home"), "getHome");
    expect(home).toMatchObject({ gradeKeys });
    const taken = await api.call("PATCH", "/v1/settings", {
      gradeKeys: { ok: "Digit2", ng: "KeyJ" },
    });
    expect(await contracted(taken, "updateSettings")).toMatchObject({
      settings: { gradeKeys: { ok: "Digit2", ng: "KeyJ", hard: "KeyS" } },
    });
  });

  it("saves a key for hard the learner sets beside the pair", async () => {
    const api = makeApi();
    await api.call("PATCH", "/v1/settings", { topics: ["work"] });
    const gradeKeys = { ok: "KeyL", ng: "KeyJ", hard: "KeyK" };
    const saved = await api.call("PATCH", "/v1/settings", { gradeKeys });
    expect(await contracted(saved, "updateSettings")).toMatchObject({
      settings: { gradeKeys },
    });
  });

  it.each([
    ["hard on the key ok is on", { ok: "KeyK", ng: "KeyJ", hard: "KeyK" }],
    ["hard on the key ng is on", { ok: "KeyK", ng: "KeyJ", hard: "KeyJ" }],
    ["hard on Enter", { ok: "KeyK", ng: "KeyJ", hard: "Enter" }],
    ["both grades on one key", { ok: "KeyJ", ng: "KeyJ" }],
    ["a grade on Space", { ok: "Space", ng: "KeyJ" }],
    ["a grade on Enter", { ok: "KeyK", ng: "Enter" }],
    ["a grade on Escape", { ok: "Escape", ng: "KeyJ" }],
    ["a grade on the key `?` is on", { ok: "KeyK", ng: "Slash" }],
    ["a grade on a keypad digit", { ok: "Numpad1", ng: "KeyJ" }],
    ["a grade given as a character", { ok: "k", ng: "j" }],
    ["one grade missing", { ok: "KeyK" }],
  ])(
    "answers 400 ERR_BAD_REQUEST for %s, and keeps the keys it had",
    async (_, gradeKeys) => {
      const api = makeApi();
      await api.call("PATCH", "/v1/settings", {
        topics: ["work"],
        gradeKeys: { ok: "KeyL", ng: "KeyA" },
      });
      expect(
        await refusal(await api.call("PATCH", "/v1/settings", { gradeKeys })),
      ).toStrictEqual([400, "ERR_BAD_REQUEST"]);
      const page = await contracted(
        await api.call("GET", "/v1/settings"),
        "getSettings",
      );
      expect(page).toMatchObject({
        settings: { gradeKeys: { ok: "KeyL", ng: "KeyA" } },
      });
    },
  );
});

describe("the drill on FSRS", () => {
  const items = (api: ApiHarness, learner = "learner-1") =>
    api.stores.forLearner(learnerId(learner)).items();

  it("deals a new card with the days each grade would schedule it for", async () => {
    const api = makeApi();
    const round = await startedPlacement(api);
    const cards = Object.values(round.cards);
    expect(cards.length).toBeGreaterThan(0);
    for (const { intervals, isNew } of cards) {
      expect({ intervals, isNew }).toStrictEqual({
        intervals: { again: 1, hard: 2, good: 3 },
        isNew: true,
      });
    }
  });

  it("schedules an answer by its grade, logging the grade and the timeout, and reads them back", async () => {
    const api = makeApi();
    const round = await startedPlacement(api);
    const [cardId] = round.deck;
    if (cardId === undefined) throw new Error("No deck.");
    const answer = {
      id: `p1:f:${cardId}`,
      cardId,
      pass: "first",
      grade: "hard",
      timedOut: true,
      elapsedMs: 30_000,
    };
    expect(
      (await api.call("POST", "/v1/rounds/p1/answers", { answers: [answer] })).status,
    ).toBe(204);

    const [review] = await api.stores
      .forLearner(learnerId("learner-1"))
      .reviewsOf("p1");
    expect(review?.detail).toMatchObject({
      grade: "hard",
      timedOut: true,
      result: "timeout",
    });
    expect((await items(api)).get(cardId)?.value.fsrs?.dueDay).toBe(
      addDays(round.day, 2),
    );
    const read = await contracted(await api.call("GET", "/v1/rounds/p1"), "getRound");
    expect(read).toMatchObject({
      answered: [
        { id: answer.id, cardId, result: "timeout", grade: "hard", timedOut: true },
      ],
    });
  });

  it("reads an older client's timeout as again, timed out, due the next day", async () => {
    const api = makeApi();
    const round = await startedPlacement(api);
    const [cardId] = round.deck;
    if (cardId === undefined) throw new Error("No deck.");
    await api.call("POST", "/v1/rounds/p1/answers", {
      answers: [
        {
          id: `p1:f:${cardId}`,
          cardId,
          pass: "first",
          result: "timeout",
          elapsedMs: 30_000,
        },
      ],
    });
    const [review] = await api.stores
      .forLearner(learnerId("learner-1"))
      .reviewsOf("p1");
    expect(review?.detail).toMatchObject({
      grade: "again",
      timedOut: true,
      result: "timeout",
    });
    expect((await items(api)).get(cardId)?.value.fsrs?.dueDay).toBe(
      addDays(round.day, 1),
    );
  });

  it("logs a re-ask the same day with its grade, and leaves the due day the first answer set", async () => {
    const api = makeApi();
    await finished(api);
    await api.call("PATCH", "/v1/settings", { newPerDay: 5 });
    const started = await api.call("POST", "/v1/rounds", {
      roundId: "t1",
      kind: "today",
    });
    const round = (await contracted(started, "startRound")) as RoundPayload;
    const [cardId] = round.deck;
    if (cardId === undefined) throw new Error("No deck.");
    await api.call("POST", "/v1/rounds/t1/answers", {
      answers: [
        {
          id: `t1:f:${cardId}`,
          cardId,
          pass: "first",
          grade: "again",
          elapsedMs: 4_000,
        },
      ],
    });
    const due = (await items(api)).get(cardId)?.value.fsrs;
    await api.call("POST", "/v1/rounds/t1/answers", {
      answers: [
        {
          id: `t1:r:${cardId}`,
          cardId,
          pass: "retry",
          grade: "good",
          elapsedMs: 4_000,
        },
      ],
    });
    const reviews = await api.stores.forLearner(learnerId("learner-1")).reviewsOf("t1");
    expect(
      reviews.map((review) => [review.detail.pass, review.detail.grade]),
    ).toStrictEqual([
      ["first", "again"],
      ["retry", "good"],
    ]);
    expect(due?.dueDay).toBe(addDays(round.day, 1));
    expect((await items(api)).get(cardId)?.value.fsrs).toStrictEqual(due);
  });

  it("answers 400 ERR_BAD_REQUEST for an answer with neither a grade nor a result", async () => {
    const api = makeApi();
    const round = await startedPlacement(api);
    const [cardId] = round.deck;
    expect(
      await refusal(
        await api.call("POST", "/v1/rounds/p1/answers", {
          answers: [{ id: "p1:f:x", cardId, pass: "first", elapsedMs: 3_000 }],
        }),
      ),
    ).toStrictEqual([400, "ERR_BAD_REQUEST"]);
  });

  it("reads 5 new cards and 20 reviews a day until the learner chooses, and saves a choice", async () => {
    const api = makeApi();
    await api.call("PATCH", "/v1/settings", { topics: ["work"] });
    const page = await contracted(await api.call("GET", "/v1/settings"), "getSettings");
    expect(page).toMatchObject({ settings: { newPerDay: 5, reviewsPerDay: 20 } });
    const saved = await api.call("PATCH", "/v1/settings", {
      newPerDay: 15,
      reviewsPerDay: null,
    });
    expect(await contracted(saved, "updateSettings")).toMatchObject({
      settings: { newPerDay: 15, reviewsPerDay: null },
    });
    for (const patch of [{ newPerDay: 7 }, { reviewsPerDay: 100 }]) {
      expect(
        await refusal(await api.call("PATCH", "/v1/settings", patch)),
      ).toStrictEqual([400, "ERR_BAD_REQUEST"]);
    }
  });

  it("schedules and sets only the learner's own cards and limits, never another learner's", async () => {
    const a = makeApi({ authenticator: subjectAuthenticator("subject-a") });
    const round = await startedPlacement(a);
    const b = makeApi({
      stores: a.stores,
      directory: a.directory,
      authenticator: subjectAuthenticator("subject-b"),
      newLearnerId: () => learnerId("learner-b"),
    });
    const before = await items(a);
    const settings = await a.call("GET", "/v1/settings");
    const [cardId] = round.deck;
    if (cardId === undefined) throw new Error("No deck.");

    await b.call("PATCH", "/v1/settings", {
      topics: ["work"],
      newPerDay: 0,
      reviewsPerDay: 10,
      gradeKeys: { ok: "KeyK", ng: "KeyJ", hard: "KeyL" },
    });
    expect(
      await refusal(
        await b.call("POST", "/v1/rounds/p1/answers", {
          answers: [
            {
              id: `p1:f:${cardId}`,
              cardId,
              pass: "first",
              grade: "good",
              elapsedMs: 1,
            },
          ],
        }),
      ),
    ).toStrictEqual([404, "ERR_ROUND_NOT_FOUND"]);

    expect(await items(a)).toStrictEqual(before);
    expect(await (await a.call("GET", "/v1/settings")).json()).toStrictEqual(
      await settings.json(),
    );
    expect((await items(b, "learner-b")).size).toBe(0);
  });
});

describe("a request the contract refuses", () => {
  function send(
    api: ApiHarness,
    body: BodyInit,
    init: RequestInit = {},
  ): Promise<Response> {
    return Promise.resolve(
      api.app.fetch(
        new Request("http://localhost/api/v1/settings", {
          method: "PATCH",
          body,
          ...init,
        }),
      ),
    );
  }

  it.each([
    ["a body that is not JSON", "{"],
    ["an empty body", ""],
    ["a JSON array", "[]"],
    ["a bare JSON string", '"work"'],
    ["a value outside the closed set", JSON.stringify({ dailySize: 7 })],
    ["a field of the wrong type", JSON.stringify({ sound: "yes" })],
  ])("answers 400 ERR_BAD_REQUEST for %s", async (_, body) => {
    expect(await refusal(await send(makeApi(), body))).toStrictEqual([
      400,
      "ERR_BAD_REQUEST",
    ]);
  });

  it("answers 413 for a body over the ceiling, whatever Content-Length claims", async () => {
    const body = JSON.stringify({ topics: ["x".repeat(MAX_REQUEST_BODY_BYTES)] });
    expect(await refusal(await send(makeApi(), body))).toStrictEqual([
      413,
      "ERR_PAYLOAD_TOO_LARGE",
    ]);
  });

  it("answers 400 for a body whose stream fails part-way", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("the client hung up"));
      },
    });
    const response = await send(makeApi(), stream, { duplex: "half" } as RequestInit);
    expect(await refusal(response)).toStrictEqual([400, "ERR_BAD_REQUEST"]);
  });

  it("answers 400 for a round id longer than the contract allows", async () => {
    const api = makeApi();
    const response = await api.call("GET", `/v1/rounds/${"r".repeat(65)}/summary`);
    expect(await refusal(response)).toStrictEqual([400, "ERR_BAD_REQUEST"]);
  });

  it("answers the fixed sentence for the code, never what the request carried", async () => {
    const response = await send(makeApi(), JSON.stringify({ topics: [42] }));
    expect(await response.json()).toStrictEqual({
      error: { code: "ERR_BAD_REQUEST", message: MESSAGE_BY_CODE.ERR_BAD_REQUEST },
    });
  });
});

describe("who a request acts as", () => {
  it("does not find another learner's round, and leaves it as it was", async () => {
    const a = makeApi({ authenticator: subjectAuthenticator("subject-a") });
    await finished(a);
    const b = makeApi({
      stores: a.stores,
      directory: a.directory,
      authenticator: subjectAuthenticator("subject-b"),
      newLearnerId: () => learnerId("learner-b"),
    });
    const before = await a.call("GET", "/v1/rounds/p1/summary");
    const round = await a.call("GET", "/v1/rounds/p1");

    expect(await refusal(await b.call("GET", "/v1/rounds/p1"))).toStrictEqual([
      404,
      "ERR_ROUND_NOT_FOUND",
    ]);
    expect(await refusal(await b.call("GET", "/v1/rounds/p1/summary"))).toStrictEqual([
      404,
      "ERR_ROUND_NOT_FOUND",
    ]);
    expect(
      await refusal(await b.call("POST", "/v1/rounds/p1/answers", { answers: [] })),
    ).toStrictEqual([404, "ERR_ROUND_NOT_FOUND"]);
    expect(
      await refusal(await b.call("POST", "/v1/rounds/p1/finish", { answers: [] })),
    ).toStrictEqual([404, "ERR_ROUND_NOT_FOUND"]);
    const after = await a.call("GET", "/v1/rounds/p1/summary");
    expect(await after.json()).toStrictEqual(await before.json());
    expect(await (await a.call("GET", "/v1/rounds/p1")).json()).toStrictEqual(
      await round.json(),
    );
    expect(b.lines.map((line) => line.learnerId)).toStrictEqual([
      "learner-b",
      "learner-b",
      "learner-b",
      "learner-b",
    ]);
  });

  it("changes only its own level, never another learner's", async () => {
    const a = makeApi({ authenticator: subjectAuthenticator("subject-a") });
    await finished(a);
    const b = makeApi({
      stores: a.stores,
      directory: a.directory,
      authenticator: subjectAuthenticator("subject-b"),
      newLearnerId: () => learnerId("learner-b"),
    });
    const before = await a.stores.forLearner(learnerId("learner-1")).stats();

    const chosen = await b.call("PATCH", "/v1/level", { mode: "manual", level: 2 });

    expect(await contracted(chosen, "updateLevel")).toMatchObject({ mode: "manual" });
    expect(await a.stores.forLearner(learnerId("learner-1")).stats()).toStrictEqual(
      before,
    );
    expect(before?.value.levelMode).toBe("auto");
    expect(
      (await a.stores.forLearner(learnerId("learner-b")).stats())?.value.level,
    ).toMatchObject({ level: 2, reason: "chosen" });
  });
});
