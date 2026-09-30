import { describe, expect, it } from "vitest";

import { learnerId, type RoundPayload } from "@instant-composition/application";
import { errorResponseSchema, ROUTES } from "@instant-composition/contracts";

import {
  batchFor,
  makeApi,
  subjectAuthenticator,
  type ApiHarness,
} from "./api-harness";

// ADR-0011's typed-answer mode over `/v1`, driven with `new Request(…)` over
// the in-memory store: the settings carry the mode, a round the mode it was
// dealt with, and an answer the text typed for it, read back from the round
// and its summary and from no other learner's calls, nor from the log.

const TYPED = "Let's get started.";

/** The body `response` carries, checked against the contract's success schema for `operationId`. */
async function contracted(response: Response, operationId: string): Promise<unknown> {
  const entry = ROUTES.find((candidate) => candidate.operationId === operationId);
  expect(response.status).toBe(entry?.success.status);
  return entry?.success.body?.parse(await response.json());
}

async function refusal(response: Response): Promise<[number, string]> {
  const body = errorResponseSchema.parse(await response.json());
  return [response.status, body.error.code];
}

/** Onboards the learner in `answerMode` and starts placement round `p1`. */
async function started(
  api: ApiHarness,
  answerMode: "spoken" | "typed",
): Promise<RoundPayload> {
  await contracted(
    await api.call("PATCH", "/v1/settings", { topics: ["work", "travel"], answerMode }),
    "updateSettings",
  );
  return (await contracted(
    await api.call("POST", "/v1/rounds", { roundId: "p1", kind: "placement" }),
    "startRound",
  )) as RoundPayload;
}

/** The round's first-pass batch, its first answer carrying `text`. */
function typedBatch(round: RoundPayload, text = TYPED) {
  const [first, ...rest] = batchFor(round).answers;
  if (first === undefined) throw new Error("No deck.");
  return { answers: [{ ...first, text }, ...rest] };
}

describe("the answer mode in the settings", () => {
  it("reads spoken until the learner chooses, then the mode chosen", async () => {
    const api = makeApi();
    await contracted(
      await api.call("PATCH", "/v1/settings", { topics: ["work"] }),
      "updateSettings",
    );
    const before = await contracted(
      await api.call("GET", "/v1/settings"),
      "getSettings",
    );

    const saved = await contracted(
      await api.call("PATCH", "/v1/settings", { answerMode: "typed" }),
      "updateSettings",
    );
    const after = await contracted(
      await api.call("GET", "/v1/settings"),
      "getSettings",
    );

    expect(before).toMatchObject({ settings: { answerMode: "spoken" } });
    expect(saved).toMatchObject({ settings: { answerMode: "typed" } });
    expect(after).toMatchObject({ settings: { answerMode: "typed" } });
  });

  it("refuses a mode the app does not ship, and keeps the one saved", async () => {
    const api = makeApi();
    await started(api, "typed");

    expect(
      await refusal(await api.call("PATCH", "/v1/settings", { answerMode: "voice" })),
    ).toStrictEqual([400, "ERR_BAD_REQUEST"]);
    expect(
      await contracted(await api.call("GET", "/v1/settings"), "getSettings"),
    ).toMatchObject({ settings: { answerMode: "typed" } });
  });
});

describe("a typed round", () => {
  it("is dealt in the typed mode, each card held only to the ten-minute cap", async () => {
    const api = makeApi();
    const round = await started(api, "typed");

    expect(round.answerMode).toBe("typed");
    expect(
      new Set(Object.values(round.cards).map((card) => card.limitMs)),
    ).toStrictEqual(new Set([600_000]));
  });

  it("returns the text typed with the answers it holds, and keeps its mode after the setting changes", async () => {
    const api = makeApi();
    const round = await started(api, "typed");
    const batch = typedBatch(round);
    expect((await api.call("POST", "/v1/rounds/p1/answers", batch)).status).toBe(204);
    await api.call("PATCH", "/v1/settings", { answerMode: "spoken" });

    const read = (await contracted(
      await api.call("GET", "/v1/rounds/p1"),
      "getRound",
    )) as RoundPayload;

    expect(read.answerMode).toBe("typed");
    expect(
      read.answered.filter((row) => row.text !== undefined).map((row) => row.id),
    ).toStrictEqual([batch.answers[0]?.id]);
    expect(read.answered.find((row) => row.id === batch.answers[0]?.id)?.text).toBe(
      TYPED,
    );
  });

  it("returns the text typed in the summary finishing answers and a later read answers", async () => {
    const api = makeApi();
    const round = await started(api, "typed");
    const batch = typedBatch(round);

    const summary = await contracted(
      await api.call("POST", "/v1/rounds/p1/finish", batch),
      "finishRound",
    );
    const read = await contracted(
      await api.call("GET", "/v1/rounds/p1/summary"),
      "getRoundSummary",
    );

    expect(summary).toMatchObject({ answerMode: "typed" });
    expect(summary).toHaveProperty(
      "answered",
      expect.arrayContaining([
        expect.objectContaining({ id: batch.answers[0]?.id, text: TYPED }),
      ]),
    );
    expect(read).toStrictEqual(summary);
  });

  it("takes an elapsedMs over the ten-minute cap and keeps it at the cap", async () => {
    const api = makeApi();
    const round = await started(api, "typed");
    const [first] = batchFor(round).answers;
    if (first === undefined) throw new Error("No deck.");

    const recorded = await api.call("POST", "/v1/rounds/p1/answers", {
      answers: [{ ...first, elapsedMs: 3_600_000 }],
    });

    expect(recorded.status).toBe(204);
    const reviews = await api.stores.forLearner(learnerId("learner-1")).reviewsOf("p1");
    expect(reviews.map((review) => review.detail.elapsedMs)).toStrictEqual([600_000]);
  });

  it.each([
    [
      "a text of 301 characters",
      (round: RoundPayload) => typedBatch(round, "x".repeat(301)),
    ],
    [
      "a timeout",
      (round: RoundPayload) => ({
        answers: batchFor(round).answers.map((answer) => ({
          ...answer,
          result: "timeout",
        })),
      }),
    ],
  ])("refuses a batch holding %s, and stores none of it", async (_, bodyOf) => {
    const api = makeApi();
    const round = await started(api, "typed");

    expect(
      await refusal(await api.call("POST", "/v1/rounds/p1/answers", bodyOf(round))),
    ).toStrictEqual([400, "ERR_BAD_REQUEST"]);
    expect(
      await api.stores.forLearner(learnerId("learner-1")).reviewsOf("p1"),
    ).toStrictEqual([]);
  });

  it("keeps the text typed out of every log line", async () => {
    const api = makeApi();
    const round = await started(api, "typed");
    await api.call("POST", "/v1/rounds/p1/answers", typedBatch(round));
    await api.call("GET", "/v1/rounds/p1");
    await api.call("POST", "/v1/rounds/p1/finish", { answers: [] });

    expect(api.lines).toHaveLength(5);
    expect(JSON.stringify(api.lines)).not.toContain(TYPED);
  });
});

describe("a spoken round", () => {
  it("is dealt in the spoken mode and refuses a text", async () => {
    const api = makeApi();
    const round = await started(api, "spoken");

    expect(round.answerMode).toBe("spoken");
    expect(
      await refusal(await api.call("POST", "/v1/rounds/p1/answers", typedBatch(round))),
    ).toStrictEqual([400, "ERR_BAD_REQUEST"]);
  });

  it("takes an elapsedMs over the ten-minute cap and holds it to the round's limit", async () => {
    const api = makeApi();
    const round = await started(api, "spoken");
    const [first] = batchFor(round).answers;
    if (first === undefined) throw new Error("No deck.");

    const recorded = await api.call("POST", "/v1/rounds/p1/answers", {
      answers: [{ ...first, elapsedMs: 900_000 }],
    });

    expect(recorded.status).toBe(204);
    const reviews = await api.stores.forLearner(learnerId("learner-1")).reviewsOf("p1");
    expect(reviews.map((review) => review.detail.elapsedMs)).toStrictEqual([30_000]);
  });
});

describe("another learner", () => {
  it("finds neither the typed round nor its summary, and leaves the text as it was", async () => {
    const a = makeApi({ authenticator: subjectAuthenticator("subject-a") });
    const round = await started(a, "typed");
    await a.call("POST", "/v1/rounds/p1/finish", typedBatch(round));
    const b = makeApi({
      stores: a.stores,
      directory: a.directory,
      authenticator: subjectAuthenticator("subject-b"),
      newLearnerId: () => learnerId("learner-b"),
    });
    const before: unknown = await (await a.call("GET", "/v1/rounds/p1/summary")).json();

    const read = await b.call("GET", "/v1/rounds/p1");
    const summary = await b.call("GET", "/v1/rounds/p1/summary");
    const answered = await b.call(
      "POST",
      "/v1/rounds/p1/answers",
      typedBatch(round, "Mine."),
    );

    expect(await refusal(read)).toStrictEqual([404, "ERR_ROUND_NOT_FOUND"]);
    expect(await refusal(summary)).toStrictEqual([404, "ERR_ROUND_NOT_FOUND"]);
    expect(await refusal(answered)).toStrictEqual([404, "ERR_ROUND_NOT_FOUND"]);
    expect(await (await a.call("GET", "/v1/rounds/p1/summary")).json()).toStrictEqual(
      before,
    );
    expect(await a.stores.forLearner(learnerId("learner-b")).reviews()).toStrictEqual(
      [],
    );
  });
});
