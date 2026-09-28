import {
  createMemoryDirectory,
  createMemoryStores,
} from "@instant-composition/adapters";
import {
  API_ROOT,
  createApp,
  localAuthenticator,
  type ApiApp,
  type Authenticator,
  type LogLine,
} from "@instant-composition/api";
import {
  learnerId,
  type Catalog,
  type LearnerDirectory,
  type LearnerId,
  type LearnerStores,
  type RoundPayload,
} from "@instant-composition/application";
import { ok } from "@instant-composition/domain";

import { fixedCatalog, NOON } from "./application-harness";

// The API app over the in-memory store and directory — the directory keeping
// its profiles in those stores, as the DynamoDB one does — and the fixture catalog,
// with a clock that stands still, numbered request and learner ids and a
// recording log. Nothing here asserts.

export interface ApiHarness {
  readonly app: ApiApp;
  readonly stores: LearnerStores;
  readonly directory: LearnerDirectory;
  readonly lines: LogLine[];
  /** Moves the clock the app reads; it stands still otherwise. */
  readonly advance: (ms: number) => void;
  readonly call: (method: string, path: string, body?: unknown) => Promise<Response>;
}

export interface ApiHarnessOptions {
  readonly catalog?: Catalog;
  readonly stores?: LearnerStores;
  readonly directory?: LearnerDirectory;
  readonly authenticator?: Authenticator;
  /** Where a first sign-in's learner id comes from: `learner-1`, `learner-2`, … by default. */
  readonly newLearnerId?: () => LearnerId;
  readonly now?: number;
  /** Headers every `call` sends, such as the credential a client carries. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** An authenticator that makes every request `subject`, as a verified token would. */
export function subjectAuthenticator(subject: string): Authenticator {
  return { authenticate: () => Promise.resolve(ok({ subject })) };
}

export function makeApi(options: ApiHarnessOptions = {}): ApiHarness {
  const stores = options.stores ?? createMemoryStores();
  const directory = options.directory ?? createMemoryDirectory(stores);
  const lines: LogLine[] = [];
  let now = options.now ?? NOON;
  let issued = 0;
  let registered = 0;
  const app = createApp({
    stores,
    catalog: options.catalog ?? fixedCatalog(),
    directory,
    newLearnerId:
      options.newLearnerId ??
      (() => {
        registered += 1;
        return learnerId(`learner-${String(registered)}`);
      }),
    authenticator: options.authenticator ?? localAuthenticator(),
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
    directory,
    lines,
    advance: (ms) => {
      now += ms;
    },
    call: async (method, path, body) =>
      app.fetch(
        new Request(`http://localhost${API_ROOT}${path}`, {
          method,
          headers: {
            ...options.headers,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
