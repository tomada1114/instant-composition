import {
  finishRound,
  history,
  home,
  recordAnswers,
  records,
  roundSummary,
  settingsPage,
  startRound,
  updateSettings,
  type ApplicationDeps,
  type ApplicationError,
  type RequestContext,
} from "@instant-composition/application";
import {
  answersRequestSchema,
  settingsPatchSchema,
  startRoundRequestSchema,
  type ErrorCode,
} from "@instant-composition/contracts";
import { err, type Result } from "@instant-composition/domain";

/** The part of a contract schema a handler uses: validation, and the value it yields. */
export interface BodySchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/** What a handler answers: the value to send, or the contract code to refuse with. */
export type Outcome = Result<unknown, { readonly code: ErrorCode }>;

/** What an operation is handed once the request is authenticated and its path checked. */
export interface OperationInput {
  readonly deps: ApplicationDeps;
  readonly context: RequestContext;
  /** The validated `{roundId}` of a round path; `""` on a path without one. */
  readonly roundId: string;
  /** The body as JSON, not yet validated: the operation checks it with its own schema. */
  readonly body: unknown;
}

/**
 * One contract operation's handler.
 *
 * @remarks
 * `body` is the very contracts schema the operation validates with, so
 * `bindRoutes` can hold it to the route's `requestBody` by identity;
 * `roundPath` says whether the route's path names a `{roundId}`.
 */
export interface Operation {
  readonly body: BodySchema<unknown> | null;
  readonly roundPath: boolean;
  handle(input: OperationInput): Promise<Outcome>;
}

type Run<A extends unknown[]> = (
  deps: ApplicationDeps,
  context: RequestContext,
  ...args: A
) => Promise<Result<unknown, ApplicationError>>;

function query(run: Run<[]>): Operation {
  return {
    body: null,
    roundPath: false,
    handle: ({ deps, context }) => run(deps, context),
  };
}

function roundQuery(run: Run<[roundId: string]>): Operation {
  return {
    body: null,
    roundPath: true,
    handle: ({ deps, context, roundId }) => run(deps, context, roundId),
  };
}

function command<T>(
  schema: BodySchema<T>,
  roundPath: boolean,
  run: Run<[roundId: string, body: T]>,
): Operation {
  return {
    body: schema,
    roundPath,
    async handle({ deps, context, roundId, body }) {
      const parsed = schema.safeParse(body);
      return parsed.success
        ? run(deps, context, roundId, parsed.data)
        : err({ code: "ERR_BAD_REQUEST" });
    },
  };
}

/** A batch's answers carry no round; the path names it (ADR-0007). */
function answersOf<A extends object>(
  roundId: string,
  answers: readonly A[],
): (A & { readonly roundId: string })[] {
  return answers.map((answer) => ({ ...answer, roundId }));
}

/**
 * Every contract operation this API serves, keyed by its `operationId` in
 * `packages/contracts`' `ROUTES`.
 */
export const OPERATIONS: Readonly<Record<string, Operation>> = {
  getSettings: query(settingsPage),
  updateSettings: command(settingsPatchSchema, false, (deps, context, _, patch) =>
    updateSettings(deps, context, patch),
  ),
  getHome: query(home),
  startRound: command(startRoundRequestSchema, false, (deps, context, _, start) =>
    startRound(deps, context, start),
  ),
  recordAnswers: command(answersRequestSchema, true, (deps, context, roundId, batch) =>
    recordAnswers(deps, context, {
      roundId,
      answers: answersOf(roundId, batch.answers),
    }),
  ),
  finishRound: command(answersRequestSchema, true, (deps, context, roundId, batch) =>
    finishRound(deps, context, { roundId, answers: answersOf(roundId, batch.answers) }),
  ),
  getRoundSummary: roundQuery(roundSummary),
  getRecords: query(records),
  getHistory: query(history),
};
