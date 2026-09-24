import { createMemoryStores } from "@instant-composition/adapters";
import {
  API_ROOT,
  createApp,
  localAuthenticator,
  type ApiApp,
  type Authenticator,
  type LogLine,
} from "@instant-composition/api";
import type {
  Catalog,
  LearnerStores,
  RoundPayload,
} from "@instant-composition/application";

import { fixedCatalog, NOON } from "./application-harness";

// The API app over the in-memory store and the fixture catalog, with a clock
// that stands still, numbered request ids and a recording log. Nothing here
// asserts.

export interface ApiHarness {
  readonly app: ApiApp;
  readonly stores: LearnerStores;
  readonly lines: LogLine[];
  /** Moves the clock the app reads; it stands still otherwise. */
  readonly advance: (ms: number) => void;
  readonly call: (method: string, path: string, body?: unknown) => Promise<Response>;
}

export interface ApiHarnessOptions {
  readonly catalog?: Catalog;
  readonly stores?: LearnerStores;
  readonly authenticator?: Authenticator;
  readonly now?: number;
}

export function makeApi(options: ApiHarnessOptions = {}): ApiHarness {
  const stores = options.stores ?? createMemoryStores();
  const lines: LogLine[] = [];
  let now = options.now ?? NOON;
  let issued = 0;
  const app = createApp({
    stores,
    catalog: options.catalog ?? fixedCatalog(),
    authenticator:
      options.authenticator ??
      localAuthenticator({ id: undefined, timeZone: undefined }),
    now: () => now,
    requestId: () => {
      issued += 1;
      return `req-${String(issued)}`;
    },
    log: (line) => {
      lines.push(line);
    },
  });
  return {
    app,
    stores,
    lines,
    advance: (ms) => {
      now += ms;
    },
    call: async (method, path, body) =>
      app.fetch(
        new Request(`http://localhost${API_ROOT}${path}`, {
          method,
          ...(body === undefined
            ? {}
            : {
                body: JSON.stringify(body),
                headers: { "content-type": "application/json" },
              }),
        }),
      ),
  };
}

/** Onboards the learner and starts a placement round `roundId`, through the API. */
export async function startedPlacement(
  api: ApiHarness,
  roundId = "p1",
): Promise<RoundPayload> {
  const saved = await api.call("PATCH", "/v1/settings", {
    topics: ["work", "travel"],
    dailySize: 10,
  });
  if (saved.status !== 200)
    throw new Error(`Saving settings answered ${String(saved.status)}.`);
  const started = await api.call("POST", "/v1/rounds", { roundId, kind: "placement" });
  if (started.status !== 200)
    throw new Error(`Starting answered ${String(started.status)}.`);
  return (await started.json()) as RoundPayload;
}

interface BatchBody {
  readonly answers: readonly {
    readonly id: string;
    readonly cardId: string;
    readonly pass: "first";
    readonly result: "ok" | "ng";
    readonly elapsedMs: number;
  }[];
}

/** A batch body for every card of the round's first pass, as a client sends it: no roundId. */
export function batchFor(round: RoundPayload, result: "ok" | "ng" = "ok"): BatchBody {
  return {
    answers: round.deck.map((cardId) => ({
      id: `${round.id}:f:${cardId}`,
      cardId,
      pass: "first",
      result,
      elapsedMs: 3_000,
    })),
  };
}
