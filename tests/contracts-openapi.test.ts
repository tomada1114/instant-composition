import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMPONENTS,
  openApiDocument,
  ROUTES,
  startRoundRequestSchema,
  type Route,
} from "@instant-composition/contracts";
import { format, resolveConfig } from "prettier";
import { describe, expect, it } from "vitest";
import * as z from "zod";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const documentPath = path.join(repoRoot, "packages/contracts/openapi.json");

/** Every `$ref` anywhere under `value`. */
function refsIn(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(refsIn);
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, inner]) =>
      key === "$ref" && typeof inner === "string" ? [inner] : refsIn(inner),
    );
  }
  return [];
}

/** Every key anywhere under `value`. */
function keysIn(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(keysIn);
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysIn(inner)]);
  }
  return [];
}

describe("the committed OpenAPI document", () => {
  // CI runs vitest with CI set, where a missing or different file fails rather
  // than being written; `pnpm contracts:openapi` is the one way to rewrite it.
  it("is what the schemas generate, formatted as Prettier leaves it", async () => {
    const options = await resolveConfig(documentPath);
    const text = await format(JSON.stringify(openApiDocument()), {
      ...options,
      filepath: documentPath,
    });
    await expect(text).toMatchFileSnapshot(documentPath);
  });
});

describe("openApiDocument", () => {
  const document = openApiDocument();

  it("is OpenAPI 3.1 served under /api, so a client calls /api/v1/...", () => {
    expect(document.openapi).toBe("3.1.1");
    expect(document.servers).toStrictEqual([{ url: "/api" }]);
  });

  it("marks the settings page's toeic deprecated while /v1 still serves it", () => {
    const schema = document.components.schemas["SettingsPageView"];
    expect(schema).toMatchObject({
      properties: { toeic: { deprecated: true, type: ["string", "null"] } },
    });
    expect(schema?.required).toContain("toeic");
  });

  it("lists exactly the operations today's commands and queries back", () => {
    const operations = Object.entries(document.paths).flatMap(([route, methods]) =>
      Object.entries(methods).map(
        ([method, operation]) =>
          `${method.toUpperCase()} ${route} ${operation.operationId}`,
      ),
    );
    expect(operations.sort()).toStrictEqual([
      "DELETE /v1/vocab/cards/{cardId} deleteVocabCard",
      "GET /v1/history getHistory",
      "GET /v1/home getHome",
      "GET /v1/me getProfile",
      "GET /v1/records getRecords",
      "GET /v1/rounds/{roundId} getRound",
      "GET /v1/rounds/{roundId}/summary getRoundSummary",
      "GET /v1/settings getSettings",
      "GET /v1/talks/{talkId} getTalk",
      "GET /v1/vocab getVocab",
      "PATCH /v1/level updateLevel",
      "PATCH /v1/me updateProfile",
      "PATCH /v1/settings updateSettings",
      "POST /v1/rounds startRound",
      "POST /v1/rounds/{roundId}/answers recordAnswers",
      "POST /v1/rounds/{roundId}/finish finishRound",
      "POST /v1/talks startTalk",
      "POST /v1/talks/{talkId}/candidates makeCandidates",
      "POST /v1/talks/{talkId}/cards addCards",
      "POST /v1/talks/{talkId}/end endTalk",
      "POST /v1/talks/{talkId}/reply retryReply",
      "POST /v1/talks/{talkId}/turns sendTurn",
      "POST /v1/talks/{talkId}/turns/{turn}/recital recordRecital",
      "POST /v1/vocab/sessions startVocabSession",
      "POST /v1/vocab/sessions/{sessionId}/answers recordVocabAnswers",
      "POST /v1/vocab/sessions/{sessionId}/finish finishVocabSession",
    ]);
  });

  it("validates a recital's {talkId} as an id and its {turn} as 1 to 6", () => {
    const operation =
      document.paths["/v1/talks/{talkId}/turns/{turn}/recital"]?.["post"];
    expect(operation?.parameters).toStrictEqual([
      {
        name: "talkId",
        in: "path",
        required: true,
        schema: { type: "string", minLength: 1, maxLength: 64 },
      },
      {
        name: "turn",
        in: "path",
        required: true,
        schema: {
          type: "integer",
          minimum: 1,
          maximum: 6,
        },
      },
    ]);
    expect(operation?.responses["204"]).toStrictEqual({
      description: "Done; no body.",
    });
  });

  it("validates a vocabulary session's {sessionId} as an id, and answers another learner's 404", () => {
    for (const end of ["answers", "finish"]) {
      const operation =
        document.paths[`/v1/vocab/sessions/{sessionId}/${end}`]?.["post"];
      expect(operation?.parameters).toStrictEqual([
        {
          name: "sessionId",
          in: "path",
          required: true,
          schema: { type: "string", minLength: 1, maxLength: 64 },
        },
      ]);
      expect(operation?.responses["404"]?.description).toMatch(
        /^ERR_SESSION_NOT_FOUND: /,
      );
    }
  });

  it("validates a card's {cardId} as an id, answering another learner's 404 and a catalog card's 403", () => {
    const operation = document.paths["/v1/vocab/cards/{cardId}"]?.["delete"];
    expect(operation?.parameters).toStrictEqual([
      {
        name: "cardId",
        in: "path",
        required: true,
        schema: { type: "string", minLength: 1, maxLength: 64 },
      },
    ]);
    expect(operation?.responses["204"]).toStrictEqual({
      description: "Done; no body.",
    });
    expect(operation?.responses["404"]?.description).toMatch(/^ERR_CARD_NOT_FOUND: /);
    expect(operation?.responses["403"]?.description).toMatch(/ERR_CARD_NOT_PERSONAL: /);
  });

  it("answers unavailable scenes, turn claims, replies or candidates with 503 ERR_MODEL_UNAVAILABLE", () => {
    for (const path of [
      "/v1/talks",
      "/v1/talks/{talkId}/turns",
      "/v1/talks/{talkId}/reply",
      "/v1/talks/{talkId}/candidates",
    ]) {
      expect(document.paths[path]?.["post"]?.responses["503"]?.description).toMatch(
        /ERR_MODEL_UNAVAILABLE: /,
      );
    }
    expect(
      document.paths["/v1/talks/{talkId}/turns"]?.["post"]?.responses["404"]
        ?.description,
    ).toMatch(/^ERR_TALK_NOT_FOUND: /);
  });

  it("resolves every $ref to a component it carries", () => {
    const refs = new Set(refsIn(document));
    const components = Object.keys(document.components.schemas);
    expect(
      [...refs].filter((ref) => !components.includes(ref.split("/").at(-1) ?? "")),
    ).toStrictEqual([]);
    expect(components).toStrictEqual(Object.keys(COMPONENTS));
  });

  it("leaves every object open, so /v1 can add a field without breaking a client", () => {
    expect(keysIn(document)).not.toContain("$schema");
    expect(keysIn(document)).not.toContain("$id");
    expect(JSON.stringify(document)).not.toContain('"additionalProperties":false');
  });

  it("answers a batch of answers with 204 and no body", () => {
    const operation = document.paths["/v1/rounds/{roundId}/answers"]?.["post"];
    expect(operation?.responses["204"]).toStrictEqual({
      description: "Done; no body.",
    });
    expect(operation?.parameters).toStrictEqual([
      {
        name: "roundId",
        in: "path",
        required: true,
        schema: { type: "string", minLength: 1, maxLength: 64 },
      },
    ]);
  });

  it("groups each operation's error codes under their statuses, in the one envelope", () => {
    const responses =
      document.paths["/v1/rounds/{roundId}/finish"]?.["post"]?.responses;
    expect(Object.keys(responses ?? {})).toStrictEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "409",
      "413",
      "503",
    ]);
    expect(responses?.["409"]?.description).toMatch(
      /^ERR_CONFLICT: .* ERR_ROUND_CLOSED: /,
    );
    expect(responses?.["404"]?.content).toStrictEqual({
      "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } },
    });
  });

  const probe: Route = {
    method: "post",
    path: "/v1/probe",
    operationId: "probe",
    summary: "A probe.",
    requestBody: startRoundRequestSchema,
    success: { status: 204, body: null },
    errors: [],
  };

  it("builds a route it is handed rather than only the shipped table", () => {
    expect(Object.keys(openApiDocument([probe]).paths)).toStrictEqual(["/v1/probe"]);
    expect(ROUTES).toHaveLength(26);
  });

  it.each([
    ["a request body", { ...probe, requestBody: z.object({ unnamed: z.string() }) }],
    [
      "a response body",
      { ...probe, success: { status: 200, body: z.object({ unnamed: z.string() }) } },
    ],
  ] as const)("refuses %s that is not a named component", (_, route) => {
    expect(() => openApiDocument([route])).toThrow(Error);
  });

  it("refuses a path parameter it has no schema for", () => {
    expect(() => openApiDocument([{ ...probe, path: "/v1/decks/{deckId}" }])).toThrow(
      Error,
    );
  });
});
