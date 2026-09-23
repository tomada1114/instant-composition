import { afterEach, describe, expect, it } from "vitest";

import { POST as answersRoute } from "../src/app/api/answers/route";
import { GET as historyRoute } from "../src/app/api/history/route";
import { POST as finishRoute } from "../src/app/api/rounds/finish/route";
import { POST as roundsRoute } from "../src/app/api/rounds/route";
import { PUT as settingsRoute } from "../src/app/api/settings/route";
import {
  answersHandler,
  finishHandler,
  historyHandler,
  roundsHandler,
  settingsHandler,
} from "../src/server/composition";
import { createAnswersHandler } from "../src/server/handlers/answers";
import { createFinishHandler } from "../src/server/handlers/finish";
import { createHistoryHandler } from "../src/server/handlers/history";
import { createRoundsHandler } from "../src/server/handlers/rounds";
import { createSettingsHandler } from "../src/server/handlers/settings";
import type { RoundPayload } from "../src/core/views";
import { removeContentRoots } from "./cards-fixture";
import { firstPassAnswers, makeHarness, type Harness } from "./services-harness";

const harnesses: Harness[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
  removeContentRoots();
});

function setUp(): Harness {
  const harness = makeHarness();
  harnesses.push(harness);
  harness.services.updateSettings({ topics: ["work", "daily"] });
  return harness;
}

function request(path: string, method: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

async function errorCode(response: Response): Promise<unknown> {
  const body = (await response.json()) as { error?: { code?: unknown } };
  return body.error?.code;
}

function handlers(harness: Harness) {
  const deps = { services: () => harness.services };
  return {
    rounds: createRoundsHandler(deps),
    answers: createAnswersHandler(deps),
    finish: createFinishHandler(deps),
    settings: createSettingsHandler(deps),
    history: createHistoryHandler(deps),
  };
}

async function startedRound(harness: Harness): Promise<RoundPayload> {
  const response = await handlers(harness).rounds(
    request("/api/rounds", "POST", { kind: "placement" }),
  );
  return (await response.json()) as RoundPayload;
}

describe("the route files", () => {
  it("re-export the composed handlers under their verbs", () => {
    expect(roundsRoute).toBe(roundsHandler);
    expect(answersRoute).toBe(answersHandler);
    expect(finishRoute).toBe(finishHandler);
    expect(settingsRoute).toBe(settingsHandler);
    expect(historyRoute).toBe(historyHandler);
  });
});

describe("POST /api/rounds", () => {
  it("answers the round as JSON", async () => {
    const harness = setUp();
    const response = await handlers(harness).rounds(
      request("/api/rounds", "POST", { kind: "placement" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ kind: "placement", total: 10 });
  });

  it.each([
    ["a body that is not JSON", "{"],
    ["a kind outside the list", { kind: "bonus" }],
    ["no kind at all", {}],
    ["a JSON array", []],
  ])("refuses %s with 400 ERR_BAD_REQUEST", async (_, body) => {
    const response = await handlers(setUp()).rounds(
      request("/api/rounds", "POST", body),
    );
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("ERR_BAD_REQUEST");
  });

  it("answers 409 ERR_ROUND_CLOSED when yesterday cannot be made up", async () => {
    const response = await handlers(setUp()).rounds(
      request("/api/rounds", "POST", { kind: "yesterday" }),
    );
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("ERR_ROUND_CLOSED");
  });
});

describe("POST /api/answers", () => {
  it("stores an answer and answers 204", async () => {
    const harness = setUp();
    const round = await startedRound(harness);
    const answer = firstPassAnswers(round)[0];
    const response = await handlers(harness).answers(
      request("/api/answers", "POST", answer),
    );
    expect(response.status).toBe(204);
    expect(harness.store.allAnswers()).toHaveLength(1);
  });

  it("answers 404 ERR_ROUND_NOT_FOUND for an unknown round", async () => {
    const harness = setUp();
    const round = await startedRound(harness);
    const answer = { ...firstPassAnswers(round)[0], roundId: "nope" };
    const response = await handlers(harness).answers(
      request("/api/answers", "POST", answer),
    );
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("ERR_ROUND_NOT_FOUND");
  });

  it("refuses an elapsed time out of range", async () => {
    const harness = setUp();
    const round = await startedRound(harness);
    const answer = { ...firstPassAnswers(round)[0], elapsedMs: -1 };
    const response = await handlers(harness).answers(
      request("/api/answers", "POST", answer),
    );
    expect(response.status).toBe(400);
  });
});

describe("POST /api/rounds/finish", () => {
  it("answers the summary", async () => {
    const harness = setUp();
    const round = await startedRound(harness);
    const response = await handlers(harness).finish(
      request("/api/rounds/finish", "POST", {
        roundId: round.id,
        answers: firstPassAnswers(round),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      roundId: round.id,
      portionCompleted: true,
    });
  });

  it("refuses a body without answers", async () => {
    const response = await handlers(setUp()).finish(
      request("/api/rounds/finish", "POST", { roundId: "r" }),
    );
    expect(response.status).toBe(400);
  });
});

describe("PUT /api/settings", () => {
  it("answers the saved settings and their effect", async () => {
    const response = await handlers(setUp()).settings(
      request("/api/settings", "PUT", { sound: false }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      settings: { topics: ["work", "daily"], sound: false },
      completedToday: false,
    });
  });

  it.each([
    ["an unknown topic", { topics: ["space"] }],
    ["no topic", { topics: [] }],
    [
      "three focus subtopics",
      {
        focus: [
          { topic: "work", subtopic: "meetings" },
          { topic: "work", subtopic: "requests" },
          { topic: "daily", subtopic: "home" },
        ],
      },
    ],
    ["a size outside the list", { dailySize: 12 }],
  ])("refuses %s with 400", async (_, body) => {
    const response = await handlers(setUp()).settings(
      request("/api/settings", "PUT", body),
    );
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("ERR_BAD_REQUEST");
  });
});

describe("GET /api/history", () => {
  it("answers the history for card generation", async () => {
    const response = await handlers(setUp()).history(request("/api/history", "GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({
      seenIds: [],
      topics: ["work", "daily"],
      focusSubtopics: [],
      estimatedLevel: 1,
    });
  });
});
