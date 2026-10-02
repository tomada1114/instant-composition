import { describe, expect, expectTypeOf, it } from "vitest";

import { createStandInModel } from "@instant-composition/adapters";
import { standInTalkModel } from "@instant-composition/api";
import type { ModelFailure, ModelReply } from "@instant-composition/application";
import { fitsCardText, type CardText, type Result } from "@instant-composition/domain";

import { describeLanguageModelContract, makeRequest } from "./language-model-contract";

// The stand-in model: scripted answers per task, the requests it got, and a
// failure it can be told to give. Nothing here reaches a provider.

describeLanguageModelContract("the stand-in", (output) =>
  createStandInModel({ "talk-partner": () => output }),
);

const signal = (): AbortSignal => new AbortController().signal;

describe("createStandInModel", () => {
  it("answers each task from its own script entry, with a call record that billed nothing", async () => {
    const model = createStandInModel({
      "talk-partner": () => ({ line: "Oh, nice." }),
      "talk-teacher": () => ({ line: "Say: I'm swamped." }),
    });

    const result = await model.generate(
      makeRequest({ task: "talk-teacher" }),
      signal(),
    );

    expect(result).toStrictEqual({
      ok: true,
      value: {
        value: { line: "Say: I'm swamped." },
        call: {
          provider: "stand-in",
          modelId: "stand-in",
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
          costUsd: 0,
        },
      },
    });
  });

  it("hands the script the request, so an answer can follow the talk so far", async () => {
    const model = createStandInModel({
      "talk-partner": (request) => ({
        line: `${String(request.messages.length)} lines in`,
      }),
    });

    const result = await model.generate(makeRequest({ messages: [] }), signal());

    expect(result.ok && result.value.value).toStrictEqual({ line: "0 lines in" });
  });

  it("records every request it got, in order, the failed ones included", async () => {
    const model = createStandInModel({ "talk-partner": () => ({ line: "Oh, nice." }) });
    const first = makeRequest({ promptVersion: "talk-partner@1" });
    const second = makeRequest({ promptVersion: "talk-partner@2" });

    await model.generate(first, signal());
    model.failWith("throttled");
    await model.generate(second, signal());

    expect(model.requests).toStrictEqual([first, second]);
  });

  it.each(["timeout", "throttled", "denied", "malformed", "transport"] as const)(
    "fails every call with %s once told to, until told to stop",
    async (reason) => {
      const model = createStandInModel({
        "talk-partner": () => ({ line: "Oh, nice." }),
      });

      model.failWith(reason);
      const failed = [
        await model.generate(makeRequest(), signal()),
        await model.generate(makeRequest(), signal()),
      ];
      model.failWith(undefined);
      const answered = await model.generate(makeRequest(), signal());

      expect(failed).toStrictEqual([
        { ok: false, error: { code: "ERR_MODEL_UNAVAILABLE", reason } },
        { ok: false, error: { code: "ERR_MODEL_UNAVAILABLE", reason } },
      ]);
      expect(answered.ok).toBe(true);
    },
  );

  it.each(["talk-scene", "toString"])(
    "rejects a request for %s, a task its script does not hold",
    async (task) => {
      const model = createStandInModel({
        "talk-partner": () => ({ line: "Oh, nice." }),
      });

      await expect(model.generate(makeRequest({ task }), signal())).rejects.toThrow(
        Error,
      );
    },
  );

  it("types the reply by what the request's read returns", async () => {
    const model = createStandInModel({ "talk-partner": () => ({ line: "Oh, nice." }) });

    const result = await model.generate(makeRequest(), signal());

    expectTypeOf(result).toEqualTypeOf<
      Result<ModelReply<{ readonly line: string }>, ModelFailure>
    >();
  });
});

describe("the stand-in a keyless run serves", () => {
  it("answers the cards task with one card per turn it is sent, each meeting the card rules", async () => {
    const model = standInTalkModel();
    const turns = [1, 2, 3, 4, 5, 6];
    const text = turns
      .map(
        (turn) => `<turn number="${String(turn)}">\n<japanese>例</japanese>\n</turn>`,
      )
      .join("\n");

    const result = await model.generate(
      {
        ...makeRequest(),
        task: "talk-cards",
        promptVersion: "talk-cards@1",
        messages: [{ role: "user", text }],
        output: {
          name: "talk_cards",
          schema: { type: "object" },
          read: (value) => value,
        },
      },
      signal(),
    );
    const { candidates } = (result.ok ? result.value.value : {}) as {
      candidates?: (CardText & { turn: number })[];
    };

    expect(candidates?.map((candidate) => candidate.turn)).toStrictEqual(turns);
    expect(candidates?.every((candidate) => fitsCardText(candidate))).toBe(true);
    expect(new Set(candidates?.map((candidate) => candidate.headword)).size).toBe(6);
  });
});
