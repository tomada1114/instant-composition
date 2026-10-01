import { describe, expect, it } from "vitest";

import type {
  JsonSchemaObject,
  LanguageModel,
  ModelRequest,
} from "@instant-composition/application";

// The contract every LanguageModel adapter runs: the stand-in and OpenRouter
// today. Each implementation is handed the output its model "returns", as
// parsed JSON, and the cases check what the port promises about it.

/** A model whose provider answers every call with `output`. */
export type ModelAnswering = (output: unknown) => LanguageModel;

interface Line {
  readonly line: string;
}

const LINE_SCHEMA = {
  type: "object",
  properties: { line: { type: "string" } },
  required: ["line"],
  additionalProperties: false,
} as const satisfies JsonSchemaObject;

function readLine(value: unknown): Line | undefined {
  return typeof value === "object" &&
    value !== null &&
    "line" in value &&
    typeof value.line === "string"
    ? { line: value.line }
    : undefined;
}

/** A partner-shaped request, with whatever the case overrides. */
export function makeRequest(
  overrides: Partial<ModelRequest<Line>> = {},
): ModelRequest<Line> {
  return {
    task: "talk-partner",
    promptVersion: "talk-partner@1",
    system: "You are a friendly local.",
    messages: [
      { role: "assistant", text: "Hi! Where are you from?" },
      { role: "user", text: "<japanese>東京です</japanese> I'm from Tokyo." },
    ],
    output: { name: "partner_line", schema: LINE_SCHEMA, read: readLine },
    temperature: 0.7,
    maxOutputTokens: 150,
    ...overrides,
  };
}

const MALFORMED = {
  ok: false,
  error: { code: "ERR_MODEL_UNAVAILABLE", reason: "malformed" },
};
const TIMEOUT = {
  ok: false,
  error: { code: "ERR_MODEL_UNAVAILABLE", reason: "timeout" },
};

export function describeLanguageModelContract(
  name: string,
  answering: ModelAnswering,
): void {
  describe(`${name} as a LanguageModel`, () => {
    it("answers with the output as the request's read narrowed it", async () => {
      const model = answering({ line: "Oh, nice.", extra: "dropped by read" });

      const result = await model.generate(makeRequest(), new AbortController().signal);

      expect(result.ok && result.value.value).toStrictEqual({ line: "Oh, nice." });
    });

    it.each([
      ["a value of the wrong shape", { line: 7 }],
      ["an array", [{ line: "Oh, nice." }]],
      ["a bare string", "Oh, nice."],
      ["null", null],
    ])("refuses %s that read refuses as malformed", async (_label, output) => {
      const model = answering(output);

      const result = await model.generate(makeRequest(), new AbortController().signal);

      expect(result).toStrictEqual(MALFORMED);
    });

    it("answers timeout when the signal has already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await answering({ line: "Oh, nice." }).generate(
        makeRequest(),
        controller.signal,
      );

      expect(result).toStrictEqual(TIMEOUT);
    });
  });
}
