import { vi } from "vitest";
import { type AnswerInput, type QueueStorage } from "@instant-composition/web";
import { NOON } from "./application-harness";
import type { ApiHarness } from "./api-harness";

/** Transport boundary only: endpoint bodies reach the actual Hono/application/store. */
export function connectClient(api: ApiHarness): {
  requests: Request[];
  failNext: (kind: "offline" | "lost-response" | "conflict") => void;
  disconnected: (value: boolean) => void;
} {
  let disconnected = false;
  let failure: "offline" | "lost-response" | "conflict" | undefined;
  const requests: Request[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const request = new Request(new URL(url, "http://localhost"), init);
    requests.push(request.clone());
    if (disconnected) throw new TypeError("fixture disconnected");
    const broken = failure;
    failure = undefined;
    if (broken === "offline") throw new TypeError("fixture disconnected");
    if (broken === "conflict")
      return Response.json({ error: { code: "ERR_CONFLICT" } }, { status: 409 });
    const response = await api.app.fetch(request);
    if (broken === "lost-response") throw new TypeError("fixture lost acknowledgement");
    return response;
  });
  return {
    requests,
    disconnected: (value) => {
      disconnected = value;
    },
    failNext: (kind: NonNullable<typeof failure>) => {
      failure = kind;
    },
  };
}

export function queueStorage(): QueueStorage {
  const held = new Map<string, string>();
  return {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => {
      held.set(key, value);
    },
    removeItem: (key) => {
      held.delete(key);
    },
  };
}

export function queuedAnswer(
  roundId: string,
  cardId: string,
  overrides: Partial<AnswerInput> = {},
): AnswerInput {
  return {
    id: `${roundId}:f:${cardId}`,
    roundId,
    cardId,
    pass: "first",
    grade: "good",
    timedOut: false,
    elapsedMs: 1000,
    answeredAt: NOON,
    ...overrides,
  };
}
