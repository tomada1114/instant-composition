import { describe, expect, it } from "vitest";

import {
  localModel,
  standInTalkModel,
  type ModelCallLine,
} from "@instant-composition/api";
import { learnerId, type LanguageModel } from "@instant-composition/application";
import {
  cardCandidatesSchema,
  errorResponseSchema,
  partnerReplySchema,
  ROUTES,
  talkEndedSchema,
  talkOpenedSchema,
  turnResultSchema,
} from "@instant-composition/contracts";
import { err } from "@instant-composition/domain";
import type * as z from "zod";

import { makeApi, subjectAuthenticator, type ApiHarness } from "./api-harness";

// The talk operations driven with `new Request(…)` over the in-memory store
// and the stand-in model a keyless local run serves: a whole talk, each answer
// checked against the contract's schema, the refusals each route owes, another
// learner's talk not found by any route, and one model-call line per call that
// carries none of the talk's text.

const DAY_MS = 86_400_000;

async function contracted<T>(
  response: Response,
  operationId: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const entry = ROUTES.find((candidate) => candidate.operationId === operationId);
  expect(response.status).toBe(entry?.success.status);
  return schema.parse(await response.json());
}

async function refusal(response: Response): Promise<[number, string]> {
  const body = errorResponseSchema.parse(await response.json());
  return [response.status, body.error.code];
}

const turn = (n: number, english: string | null = `I said turn ${String(n)}.`) => ({
  turn: n,
  japanese: `ターン${String(n)}で言いたかったこと`,
  english,
});

async function started(api: ApiHarness, talkId = "t1") {
  return contracted(
    await api.call("POST", "/v1/talks", { talkId }),
    "startTalk",
    talkOpenedSchema,
  );
}

async function sent(
  api: ApiHarness,
  n: number,
  english?: string | null,
  talkId = "t1",
) {
  return contracted(
    await api.call("POST", `/v1/talks/${talkId}/turns`, turn(n, english)),
    "sendTurn",
    turnResultSchema,
  );
}

/** Two learners on one store: A has talk `t1` holding one turn, B none. */
async function twoLearners() {
  const a = makeApi({ authenticator: subjectAuthenticator("subject-a") });
  await started(a);
  await sent(a, 1);
  const b = makeApi({
    stores: a.stores,
    directory: a.directory,
    authenticator: subjectAuthenticator("subject-b"),
    newLearnerId: () => learnerId("learner-b"),
  });
  const stored = () => a.stores.forLearner(learnerId("learner-1")).talk("t1");
  return { a, b, stored };
}

describe("a whole talk on the stand-in model", () => {
  it("starts, takes six turns, keeps a recital and ends kept", async () => {
    const api = makeApi();

    const opened = await started(api);
    expect(opened.talkId).toBe("t1");
    expect(opened.opening).not.toBe("");

    for (const n of [1, 2, 3, 4, 5]) {
      const result = await sent(api, n, n === 3 ? null : undefined);
      expect(result.judgment.verdict).toBe("corrected");
      expect(result.reply).toMatchObject({ closing: false });
    }
    const last = await sent(api, 6);
    expect(last.reply?.closing).toBe(true);

    const recital = await api.call("POST", "/v1/talks/t1/turns/1/recital", {
      revealCount: 2,
    });
    expect(recital.status).toBe(204);
    expect(await recital.text()).toBe("");

    const ended = await api.call("POST", "/v1/talks/t1/end");
    expect(await contracted(ended, "endTalk", talkEndedSchema)).toStrictEqual({
      kept: true,
    });
    expect(api.lines.every((line) => line.outcome === "ok")).toBe(true);
    expect(api.modelCalls.map((line) => line.task)).toStrictEqual([
      "talk-scene",
      ...Array.from({ length: 6 }, () => ["talk-teacher", "talk-partner"]).flat(),
    ]);
  });

  it("answers a resent start and a resent turn as kept, without a model call", async () => {
    const api = makeApi();
    const opened = await started(api);
    const first = await sent(api, 1);
    const calls = api.modelCalls.length;

    expect(await started(api)).toStrictEqual(opened);
    expect(await sent(api, 1)).toStrictEqual(first);
    expect(api.modelCalls).toHaveLength(calls);
  });

  it("discards a talk ended before its first turn", async () => {
    const api = makeApi();
    await started(api);
    const ended = await api.call("POST", "/v1/talks/t1/end");
    expect(await contracted(ended, "endTalk", talkEndedSchema)).toStrictEqual({
      kept: false,
    });
  });
});

/** Talk `t1` on `api`, six turns corrected by the stand-in, then ended. */
async function finished(api: ApiHarness): Promise<void> {
  await started(api);
  for (const n of [1, 2, 3, 4, 5, 6]) await sent(api, n);
  expect((await api.call("POST", "/v1/talks/t1/end")).status).toBe(200);
}

async function candidates(api: ApiHarness, talkId = "t1") {
  return contracted(
    await api.call("POST", `/v1/talks/${talkId}/candidates`),
    "makeCandidates",
    cardCandidatesSchema,
  );
}

describe("the card candidates at a talk's end", () => {
  it("answers a card per corrected turn from one call, and a resend the same without one", async () => {
    const api = makeApi();
    await finished(api);

    const first = await candidates(api);
    const again = await candidates(api);

    expect(
      first.candidates.map(({ index, turn, added }) => [index, turn, added]),
    ).toStrictEqual([0, 1, 2, 3, 4, 5].map((index) => [index, index + 1, false]));
    expect(again).toStrictEqual(first);
    expect(
      api.modelCalls
        .filter(({ task }) => task === "talk-cards")
        .map(({ promptVersion, outcome }) => [promptVersion, outcome]),
    ).toStrictEqual([["talk-cards@1", "ok"]]);
  });

  it("adds a pick as a personal card that the next vocabulary session deals first", async () => {
    // Example 3, over HTTP.
    const api = makeApi();
    await finished(api);
    await candidates(api);

    const added = await contracted(
      await api.call("POST", "/v1/talks/t1/cards", { candidates: [1, 1] }),
      "addCards",
      cardCandidatesSchema,
    );
    const pick = added.candidates[1];
    expect(pick).toMatchObject({ headword: "catch up", added: true, catalog: false });
    expect(pick?.cardId).toMatch(/^p_/);

    const session = await api.call("POST", "/v1/vocab/sessions", {
      sessionId: "s1",
      kind: "today",
    });
    const dealt = (await session.json()) as {
      cards: { id: string; personal: boolean }[];
    };
    expect(dealt.cards[0]).toMatchObject({ id: pick?.cardId, personal: true });
    const hub = (await (await api.call("GET", "/v1/vocab")).json()) as { weak: number };
    expect(hub.weak).toBe(1);
  });

  it("answers 503 when the call fails, 409 before the end, and 400 for a pick it cannot take", async () => {
    const api = makeApi();
    await started(api);
    await sent(api, 1);
    expect(
      await refusal(await api.call("POST", "/v1/talks/t1/candidates")),
    ).toStrictEqual([409, "ERR_CONFLICT"]);
    expect((await api.call("POST", "/v1/talks/t1/end")).status).toBe(200);
    expect(
      await refusal(await api.call("POST", "/v1/talks/t1/cards", { candidates: [0] })),
    ).toStrictEqual([409, "ERR_CONFLICT"]);

    api.model.failWith("malformed");
    expect(
      await refusal(await api.call("POST", "/v1/talks/t1/candidates")),
    ).toStrictEqual([503, "ERR_MODEL_UNAVAILABLE"]);
    api.model.failWith(undefined);
    await candidates(api);

    for (const body of [
      { candidates: [] },
      { candidates: [-1] },
      { candidates: [0, 0, 0, 0, 0, 0, 0] },
      { candidates: ["0"] },
      {},
    ]) {
      expect(
        await refusal(await api.call("POST", "/v1/talks/t1/cards", body)),
      ).toStrictEqual([400, "ERR_BAD_REQUEST"]);
    }
    expect(
      await refusal(await api.call("POST", "/v1/talks/t1/cards", { candidates: [1] })),
    ).toStrictEqual([400, "ERR_BAD_REQUEST"]);
  });

  it("logs none of the candidates' text", async () => {
    const api = makeApi();
    await finished(api);
    const offered = await candidates(api);
    const logged = JSON.stringify([...api.lines, ...api.modelCalls]);

    const texts = offered.candidates.flatMap(
      ({ headword, definition, example, example2, meaning }) => [
        headword,
        definition,
        example,
        example2,
        meaning,
      ],
    );
    expect(texts.filter((text) => logged.includes(text))).toStrictEqual([]);
  });
});

describe("a model that gives no answer", () => {
  it("answers a scene that could not be had with 503 ERR_MODEL_UNAVAILABLE and keeps no talk", async () => {
    const api = makeApi();
    api.model.failWith("timeout");

    expect(
      await refusal(await api.call("POST", "/v1/talks", { talkId: "t1" })),
    ).toStrictEqual([503, "ERR_MODEL_UNAVAILABLE"]);
    expect(api.lines.map(({ outcome, reason }) => ({ outcome, reason }))).toStrictEqual(
      [{ outcome: "ERR_MODEL_UNAVAILABLE", reason: null }],
    );
    expect(api.modelCalls.map(({ outcome }) => outcome)).toStrictEqual(["timeout"]);
    api.model.failWith(undefined);
    expect(await refusal(await api.call("POST", "/v1/talks/t1/end"))).toStrictEqual([
      404,
      "ERR_TALK_NOT_FOUND",
    ]);
  });

  it("keeps a turn whose calls failed, and answers a partner retry that fails again with 503", async () => {
    const api = makeApi();
    await started(api);
    api.model.failWith("transport");

    expect(await sent(api, 1)).toStrictEqual({
      judgment: { verdict: "failed", modelAnswer: "", point: "" },
      reply: null,
    });
    expect(await refusal(await api.call("POST", "/v1/talks/t1/reply"))).toStrictEqual([
      503,
      "ERR_MODEL_UNAVAILABLE",
    ]);

    api.model.failWith(undefined);
    const reply = await contracted(
      await api.call("POST", "/v1/talks/t1/reply"),
      "retryReply",
      partnerReplySchema,
    );
    expect(reply.closing).toBe(false);
    expect(reply.line).not.toBe("");
  });

  it("ends a model call when the caller hangs up", async () => {
    let calls = 0;
    const waits: LanguageModel = {
      generate: (_, signal) => {
        calls += 1;
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            resolve(err({ code: "ERR_MODEL_UNAVAILABLE", reason: "timeout" }));
          });
        });
      },
    };
    const api = makeApi({
      servedModel: { provider: "probe", modelId: "probe", model: waits },
    });
    const caller = new AbortController();
    const answer = api.app.fetch(
      new Request("http://localhost/api/v1/talks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ talkId: "t1" }),
        signal: caller.signal,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    caller.abort();

    expect(await refusal(await answer)).toStrictEqual([503, "ERR_MODEL_UNAVAILABLE"]);
    expect(calls).toBe(1);
    expect(api.modelCalls).toMatchObject([
      { provider: "probe", modelId: "probe", outcome: "timeout", inputTokens: null },
    ]);
  });
});

describe("the refusals the talk routes answer", () => {
  it.each([
    ["a turn out of order", turn(2), [409, "ERR_CONFLICT"]],
    ["a turn of 7", turn(7), [400, "ERR_BAD_REQUEST"]],
    ["English holding Japanese", turn(1, "I am 学生."), [400, "ERR_BAD_REQUEST"]],
    ["an empty Japanese", { ...turn(1), japanese: "" }, [400, "ERR_BAD_REQUEST"]],
    [
      "Japanese of 301 characters",
      { ...turn(1), japanese: "あ".repeat(301) },
      [400, "ERR_BAD_REQUEST"],
    ],
    ["English of 301 characters", turn(1, "a".repeat(301)), [400, "ERR_BAD_REQUEST"]],
    [
      "no English at all",
      { turn: 1, japanese: "こんにちは" },
      [400, "ERR_BAD_REQUEST"],
    ],
  ])("refuses %s", async (_, body, expected) => {
    const api = makeApi();
    await started(api);
    expect(
      await refusal(await api.call("POST", "/v1/talks/t1/turns", body)),
    ).toStrictEqual(expected);
  });

  it("takes a Japanese and an English of 300 characters each", async () => {
    const api = makeApi();
    await started(api);
    const response = await api.call("POST", "/v1/talks/t1/turns", {
      turn: 1,
      japanese: "あ".repeat(300),
      english: "a".repeat(300),
    });
    expect(response.status).toBe(200);
  });

  it("refuses a turn on an ended talk with ERR_TALK_CLOSED", async () => {
    const api = makeApi();
    await started(api);
    await sent(api, 1);
    await api.call("POST", "/v1/talks/t1/end");
    expect(
      await refusal(await api.call("POST", "/v1/talks/t1/turns", turn(2))),
    ).toStrictEqual([409, "ERR_TALK_CLOSED"]);
  });

  it("does not find a talk a day after it started", async () => {
    const api = makeApi();
    await started(api);
    api.advance(DAY_MS);
    expect(
      await refusal(await api.call("POST", "/v1/talks/t1/turns", turn(1))),
    ).toStrictEqual([404, "ERR_TALK_NOT_FOUND"]);
  });

  it.each([
    ["/v1/talks/t1/turns/0/recital"],
    ["/v1/talks/t1/turns/7/recital"],
    ["/v1/talks/t1/turns/01/recital"],
    ["/v1/talks/t1/turns/one/recital"],
    ["/v1/talks/t1/turns/1.0/recital"],
    [`/v1/talks/${"x".repeat(65)}/turns/1/recital`],
    [`/v1/talks/${"x".repeat(65)}/end`],
  ])("refuses the path %s before reading the talk", async (path) => {
    const api = makeApi();
    await started(api);
    await sent(api, 1);
    expect(
      await refusal(await api.call("POST", path, { revealCount: 1 })),
    ).toStrictEqual([400, "ERR_BAD_REQUEST"]);
  });

  it("refuses a recital for a turn not yet kept, or a negative count", async () => {
    const api = makeApi();
    await started(api);
    await sent(api, 1);
    expect(
      await refusal(
        await api.call("POST", "/v1/talks/t1/turns/2/recital", { revealCount: 0 }),
      ),
    ).toStrictEqual([409, "ERR_CONFLICT"]);
    expect(
      await refusal(
        await api.call("POST", "/v1/talks/t1/turns/1/recital", { revealCount: -1 }),
      ),
    ).toStrictEqual([400, "ERR_BAD_REQUEST"]);
  });
});

describe("another learner's talk", () => {
  it.each([
    ["sendTurn", "/v1/talks/t1/turns", turn(2)],
    ["retryReply", "/v1/talks/t1/reply", undefined],
    ["recordRecital", "/v1/talks/t1/turns/1/recital", { revealCount: 3 }],
    ["endTalk", "/v1/talks/t1/end", undefined],
    ["makeCandidates", "/v1/talks/t1/candidates", undefined],
    ["addCards", "/v1/talks/t1/cards", { candidates: [0] }],
  ])("is not found by %s, and is left as it was", async (operation, path, body) => {
    const { a, b, stored } = await twoLearners();
    const before = await stored();

    expect(await refusal(await b.call("POST", path, body))).toStrictEqual([
      404,
      "ERR_TALK_NOT_FOUND",
    ]);
    expect(await stored()).toStrictEqual(before);
    expect(b.lines).toMatchObject([{ operation, learnerId: "learner-b" }]);
    expect(b.modelCalls).toStrictEqual([]);
    expect(a.lines.every((line) => line.learnerId === "learner-1")).toBe(true);
  });

  it("is not answered by startTalk: the same id starts the caller's own talk", async () => {
    const { b, stored } = await twoLearners();
    const before = await stored();

    await started(b);

    expect(b.modelCalls.map(({ task }) => task)).toStrictEqual(["talk-scene"]);
    expect(await stored()).toStrictEqual(before);
    const own = await b.stores.forLearner(learnerId("learner-b")).talk("t1");
    expect(own?.value.turns).toStrictEqual([]);
  });
});

describe("the model-call line", () => {
  it("writes one line per call with exactly the documented fields", async () => {
    const api = makeApi();
    await started(api);
    await sent(api, 1);

    expect(api.modelCalls).toStrictEqual<ModelCallLine[]>(
      ["talk-scene", "talk-teacher", "talk-partner"].map((task) => ({
        kind: "model-call",
        requestId: task === "talk-scene" ? "req-1" : "req-2",
        task,
        promptVersion: `${task}@1`,
        provider: "stand-in",
        modelId: "stand-in",
        outcome: "ok",
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        costUsd: 0,
      })),
    );
  });

  it("carries none of the talk's text: no prompt, no learner's words, no model output", async () => {
    const api = makeApi();
    const opened = await started(api);
    const result = await sent(api, 1, "Secret English words.");
    const logged = JSON.stringify([...api.lines, ...api.modelCalls]);

    const texts = [
      ...Object.values(opened.scene),
      opened.opening,
      turn(1).japanese,
      "Secret English words.",
      result.judgment.modelAnswer,
      result.judgment.point,
      result.reply?.line ?? "",
      ...api.model.requests.flatMap((request) => [
        request.system,
        ...request.messages.map((message) => message.text),
      ]),
    ];
    expect(texts.filter((text) => text !== "" && logged.includes(text))).toStrictEqual(
      [],
    );
  });
});

describe("the model a local run wires", () => {
  it("is the stand-in without a key, and OpenRouter at the configured model with one", () => {
    const fetch = () => Promise.reject(new Error("no network in a test"));
    expect(localModel({ provider: "stand-in" }, fetch)).toMatchObject({
      provider: "stand-in",
      modelId: "stand-in",
    });
    expect(
      localModel(
        { provider: "openrouter", modelId: "anthropic/claude-haiku-4.5", apiKey: "k" },
        fetch,
      ),
    ).toMatchObject({ provider: "openrouter", modelId: "anthropic/claude-haiku-4.5" });
  });

  it("sends a keyed request to OpenRouter and nowhere else", async () => {
    const seen: Request[] = [];
    const model = localModel(
      {
        provider: "openrouter",
        modelId: "anthropic/claude-haiku-4.5",
        apiKey: "test-key",
      },
      (request) => {
        seen.push(request);
        return Promise.resolve(new Response(null, { status: 401 }));
      },
    );
    const api = makeApi({ servedModel: model });

    expect(
      await refusal(await api.call("POST", "/v1/talks", { talkId: "t1" })),
    ).toStrictEqual([503, "ERR_MODEL_UNAVAILABLE"]);
    expect(
      seen.map((request) => [request.url, request.headers.get("authorization")]),
    ).toStrictEqual([
      ["https://openrouter.ai/api/v1/chat/completions", "Bearer test-key"],
    ]);
    expect(api.modelCalls.map(({ outcome }) => outcome)).toStrictEqual(["denied"]);
  });

  it("answers every talk task from the stand-in's own script", async () => {
    const model = standInTalkModel();
    const api = makeApi({ standIn: model });
    await started(api);
    for (const n of [1, 2, 3, 4, 5, 6]) await sent(api, n);
    expect(model.requests).toHaveLength(13);
  });
});
