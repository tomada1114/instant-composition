import { describe, expect, it } from "vitest";

import {
  learnerId,
  type LearnerStore,
  type RoundPayload,
} from "@instant-composition/application";

import { makeReview, withRetired, without } from "./application-fixtures";
import { batchFor, makeApi, startedPlacement, type ApiHarness } from "./api-harness";

// The typed-answer mode is gone from `/v1`, but a learner's data may still
// carry it: settings, rounds and answers stored while it existed read as
// spoken, and neither the mode nor a typed text comes back. Every card of the
// fixture catalog is eight words long, a pace of ceil(4 + 8 * 0.5) = 8 seconds.

const TYPED = "Let's get started.";

function storeOf(api: ApiHarness): LearnerStore {
  return api.stores.forLearner(learnerId("learner-1"));
}

/** The body as sent, before any schema strips a field from it. */
async function raw(response: Response): Promise<Record<string, unknown>> {
  expect(response.ok).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}

describe("a request carrying the retired mode", () => {
  it("takes a settings patch with an answer mode as one without it, and shows no mode", async () => {
    const api = makeApi();

    const saved = await raw(
      await api.call("PATCH", "/v1/settings", {
        topics: ["work", "travel"],
        answerMode: "typed",
      }),
    );
    const read = await raw(await api.call("GET", "/v1/settings"));

    expect(saved["settings"]).not.toHaveProperty("answerMode");
    expect(read["settings"]).not.toHaveProperty("answerMode");
    expect((await storeOf(api).settings())?.value).not.toHaveProperty("answerMode");
  });

  it("takes an answer with a text as one without it, and stores and returns none", async () => {
    const api = makeApi();
    const round = await startedPlacement(api);
    const [first, ...rest] = batchFor(round).answers;
    if (first === undefined) throw new Error("No deck.");

    const recorded = await api.call("POST", "/v1/rounds/p1/answers", {
      answers: [{ ...first, text: TYPED }, ...rest],
    });
    const read = await api.call("GET", "/v1/rounds/p1");

    expect(recorded.status).toBe(204);
    const reviews = await storeOf(api).reviewsOf("p1");
    expect(reviews.map((review) => "text" in review.detail)).not.toContain(true);
    const body = await raw(read);
    expect(body).not.toHaveProperty("answerMode");
    expect(JSON.stringify(body)).not.toContain(TYPED);
  });
});

describe("a learner whose settings were stored in the typed mode", () => {
  it("is dealt a round under the limit, which takes a timeout", async () => {
    const api = makeApi();
    await raw(await api.call("PATCH", "/v1/settings", { topics: ["work", "travel"] }));
    const store = storeOf(api);
    const settings = await store.settings();
    if (settings === undefined) throw new Error("No settings.");
    await store.commit({
      puts: [],
      updates: [
        {
          entry: {
            type: "settings",
            value: withRetired(settings.value, { answerMode: "typed" }),
          },
          version: settings.version,
        },
      ],
      expect: [],
    });

    const started = await raw(
      await api.call("POST", "/v1/rounds", { roundId: "p1", kind: "placement" }),
    );
    const round = started as unknown as RoundPayload;
    const [first] = batchFor(round).answers;
    if (first === undefined) throw new Error("No deck.");
    const recorded = await api.call("POST", "/v1/rounds/p1/answers", {
      answers: [{ ...first, result: "timeout", elapsedMs: 0 }],
    });

    expect(started).not.toHaveProperty("answerMode");
    expect(
      new Set(Object.values(round.cards).map((card) => card.limitMs)),
    ).toStrictEqual(new Set([30_000]));
    expect((await store.round("p1"))?.value).toMatchObject({ limitMs: 30_000 });
    expect(recorded.status).toBe(204);
    expect((await store.reviewsOf("p1")).map((review) => review.detail)).toStrictEqual([
      {
        activity: "composition",
        pass: "first",
        result: "timeout",
        elapsedMs: 30_000,
        limitMs: 30_000,
        paceMs: 8_000,
      },
    ]);
  });
});

describe("a round and an answer stored in the typed mode", () => {
  /** Round `p1` rewritten as a typed round was dealt, with no limit, and a typed answer to its first card. */
  async function typedRound(api: ApiHarness): Promise<RoundPayload> {
    const round = await startedPlacement(api);
    const store = storeOf(api);
    const stored = await store.round("p1");
    const [cardId] = round.deck;
    if (stored === undefined || cardId === undefined) throw new Error("No round.");
    const review = makeReview({
      id: "p1:typed",
      sessionId: "p1",
      item: { kind: "composition", id: cardId },
    });
    const written = await store.commit({
      puts: [
        {
          type: "review",
          value: {
            ...review,
            detail: withRetired(
              { ...review.detail, limitMs: 600_000, paceMs: 22_000 },
              { answerMode: "typed", text: TYPED },
            ),
          },
        },
      ],
      updates: [
        {
          entry: {
            type: "round",
            value: withRetired(without(stored.value, "limitMs"), {
              answerMode: "typed",
            }),
          },
          version: stored.version,
        },
      ],
      expect: [],
    });
    if (!written.ok) throw new Error("Rewriting the round failed.");
    return round;
  }

  it("is returned as spoken, each card under its pace, and without the text", async () => {
    const api = makeApi();
    await typedRound(api);

    const body = await raw(await api.call("GET", "/v1/rounds/p1"));
    const read = body as unknown as RoundPayload;

    expect(body).not.toHaveProperty("answerMode");
    expect(JSON.stringify(body)).not.toContain(TYPED);
    expect(
      new Set(
        Object.values(read.cards).map((card) => [card.limitMs, card.paceMs].join()),
      ),
    ).toStrictEqual(new Set(["8000,8000"]));
    expect(read.answered.map((row) => row.id)).toStrictEqual(["p1:typed"]);
  });

  it("takes a timeout, held to each card's pace", async () => {
    const api = makeApi();
    const round = await typedRound(api);
    const [, second] = batchFor(round).answers;
    if (second === undefined) throw new Error("No deck.");

    const recorded = await api.call("POST", "/v1/rounds/p1/answers", {
      answers: [{ ...second, result: "timeout", elapsedMs: 0 }],
    });

    expect(recorded.status).toBe(204);
    const reviews = await storeOf(api).reviewsOf("p1");
    expect(reviews.find((review) => review.id === second.id)?.detail).toStrictEqual({
      activity: "composition",
      pass: "first",
      result: "timeout",
      elapsedMs: 8_000,
      limitMs: 8_000,
      paceMs: 8_000,
    });
  });

  it("finishes into a summary without the mode or the text", async () => {
    const api = makeApi();
    const round = await typedRound(api);
    const [, ...rest] = batchFor(round).answers;

    const finished = await raw(
      await api.call("POST", "/v1/rounds/p1/finish", { answers: rest }),
    );
    const read = await raw(await api.call("GET", "/v1/rounds/p1/summary"));

    expect(finished).not.toHaveProperty("answerMode");
    expect(JSON.stringify(finished)).not.toContain(TYPED);
    expect(read).toStrictEqual(finished);
  });
});
