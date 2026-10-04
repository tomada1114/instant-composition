import {
  createMemoryDirectory,
  createMemoryStores,
  type StandInModel,
} from "@instant-composition/adapters";
import {
  API_ROOT,
  createApp,
  localAuthenticator,
  standInTalkModel,
  type ApiApp,
  type Authenticator,
  type LogLine,
  type ModelCallLine,
  type ServedModel,
  type WebSession,
} from "@instant-composition/api";
import {
  rebuildCompositionReadModel,
  learnerId,
  type Catalog,
  type LearnerDirectory,
  type LearnerId,
  type LearnerStores,
  type RoundPayload,
} from "@instant-composition/application";
import { addDays, dayOf, TUNING, ok } from "@instant-composition/domain";

import { fixedCatalog, NOON } from "./application-harness";
import { prepareVocabReadModels } from "./read-model-harness";

// The API app over the in-memory store and directory — the directory keeping
// its profiles in those stores, as the DynamoDB one does — the fixture catalog
// and the stand-in talk model a keyless local run serves, with a clock that
// stands still, numbered request and learner ids and a recording log, its
// request lines and its model-call lines kept apart. Nothing here asserts.

export interface ApiHarness {
  readonly app: ApiApp;
  readonly stores: LearnerStores;
  readonly directory: LearnerDirectory;
  readonly lines: LogLine[];
  readonly modelCalls: ModelCallLine[];
  /** The stand-in behind the default model, which a case may tell to fail. */
  readonly model: StandInModel;
  /** Moves the clock the app reads; it stands still otherwise. */
  readonly advance: (ms: number) => void;
  readonly prepareComposition: (learner?: LearnerId) => Promise<void>;
  readonly prepareVocab: (learner?: LearnerId) => Promise<void>;
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
  /** The web sign-in endpoints, when the app is to serve them. */
  readonly webSession?: WebSession;
  /** The model talks are served by; the stand-in in {@link ApiHarness.model} by default. */
  readonly servedModel?: ServedModel;
  /** The stand-in to serve talks with, such as one a second app shares. */
  readonly standIn?: StandInModel;
}

/** An authenticator that makes every request `subject`, as a verified token would. */
export function subjectAuthenticator(subject: string): Authenticator {
  return { authenticate: () => Promise.resolve(ok({ subject })) };
}

export function makeApi(options: ApiHarnessOptions = {}): ApiHarness {
  const stores = options.stores ?? createMemoryStores();
  const directory = options.directory ?? createMemoryDirectory(stores);
  const lines: LogLine[] = [];
  const modelCalls: ModelCallLine[] = [];
  const model = options.standIn ?? standInTalkModel();
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
      if ("kind" in line) {
        modelCalls.push(line);
      } else {
        lines.push(line);
      }
    },
    webSession: options.webSession,
    model: options.servedModel ?? { provider: "stand-in", modelId: "stand-in", model },
  });
  async function fixtureContext(
    learner = learnerId(lines.at(-1)?.learnerId ?? "learner-1"),
  ) {
    const profile = await stores.forLearner(learner).profile();
    if (profile === undefined)
      throw new Error("Register the fixture learner before maintenance.");
    return {
      actor: {
        kind: "system" as const,
        job: "rebuild-projections" as const,
        onBehalfOf: learner,
      },
      learner: {
        ...profile.value,
        id: learner,
        dayBoundaryHour: TUNING.dayBoundaryHour,
      },
      now,
      requestId: "fixture-maintenance",
    };
  }
  return {
    app,
    stores,
    directory,
    lines,
    modelCalls,
    model,
    async prepareVocab(learner) {
      await prepareVocabReadModels(
        { stores, catalog: options.catalog ?? fixedCatalog() },
        await fixtureContext(learner),
      );
    },
    async prepareComposition(learner) {
      const context = await fixtureContext(learner);
      const today = dayOf(now, context.learner.timeZone, TUNING.dayBoundaryHour);
      for (const day of [today, addDays(today, 1)])
        for (let step = 0; step < 1000; step += 1) {
          if (
            (
              await rebuildCompositionReadModel(
                { stores, catalog: options.catalog ?? fixedCatalog() },
                context,
                day,
              )
            ).status === "ready"
          )
            break;
          if (step === 999)
            throw new Error("The fixture composition worker is incomplete.");
        }
    },
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
  await api.prepareComposition();
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
