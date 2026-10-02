import {
  finishRound,
  history,
  home,
  profile,
  recordAnswers,
  records,
  roundPayload,
  roundSummary,
  settingsPage,
  startRound,
  updateLevel,
  updateProfile,
  updateSettings,
  type ApplicationDeps,
  type CatalogUnreadable,
  type RequestContext,
  type TalkDeps,
} from "@instant-composition/application";
import {
  answersRequestSchema,
  levelChoiceSchema,
  profilePatchSchema,
  settingsPatchSchema,
  startRoundRequestSchema,
  type ErrorCode,
} from "@instant-composition/contracts";
import type { Result } from "@instant-composition/domain";

import { command, query, roundQuery } from "./handlers";
import { TALK_OPERATIONS } from "./talk-operations";
import { VOCAB_OPERATIONS } from "./vocab-operations";

/** The part of a contract schema a handler uses: validation, and the value it yields. */
export interface BodySchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/** What a handler answers: the value to send, or the contract code to refuse with. */
export type Outcome = Result<
  unknown,
  {
    readonly code: ErrorCode;
    readonly reason?: CatalogUnreadable["reason"];
  }
>;

/** The path parameters a contract path may name, each validated before an operation runs. */
export interface PathValues {
  /** The `{roundId}` of a round path; `""` on a path without one. */
  readonly roundId: string;
  /** The `{talkId}` of a talk path; `""` on a path without one. */
  readonly talkId: string;
  /** The `{turn}` of a recital path, 1 to 6; `0` on a path without one. */
  readonly turn: number;
  /** The `{sessionId}` of a vocabulary session path; `""` on a path without one. */
  readonly sessionId: string;
  /** The `{cardId}` of a vocabulary card path; `""` on a path without one. */
  readonly cardId: string;
}

export type PathParam = keyof PathValues;

/** What every operation is handed: the drill's dependencies and the talk's. */
export interface OperationDeps extends ApplicationDeps, TalkDeps {}

/** What an operation is handed once the request is authenticated and its path checked. */
export interface OperationInput {
  readonly deps: OperationDeps;
  readonly context: RequestContext;
  readonly path: PathValues;
  /** The body as JSON, not yet validated: the operation checks it with its own schema. */
  readonly body: unknown;
}

/**
 * One contract operation's handler.
 *
 * @remarks
 * `body` is the very contracts schema the operation validates with, so
 * `bindRoutes` can hold it to the route's `requestBody` by identity;
 * `params` names every parameter the route's path holds.
 */
export interface Operation {
  readonly body: BodySchema<unknown> | null;
  readonly params: readonly PathParam[];
  handle(input: OperationInput): Promise<Outcome>;
}

/** A batch's answers carry no round; the path names it. */
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
  getProfile: query(profile),
  updateProfile: command(profilePatchSchema, [], (deps, context, _, patch) =>
    updateProfile(deps, context, patch),
  ),
  getSettings: query(settingsPage),
  updateSettings: command(settingsPatchSchema, [], (deps, context, _, patch) =>
    updateSettings(deps, context, patch),
  ),
  updateLevel: command(levelChoiceSchema, [], (deps, context, _, choice) =>
    updateLevel(deps, context, choice),
  ),
  getHome: query(home),
  startRound: command(startRoundRequestSchema, [], (deps, context, _, start) =>
    startRound(deps, context, start),
  ),
  getRound: roundQuery(roundPayload),
  recordAnswers: command(
    answersRequestSchema,
    ["roundId"],
    (deps, context, { roundId }, batch) =>
      recordAnswers(deps, context, {
        roundId,
        answers: answersOf(roundId, batch.answers),
      }),
  ),
  finishRound: command(
    answersRequestSchema,
    ["roundId"],
    (deps, context, { roundId }, batch) =>
      finishRound(deps, context, {
        roundId,
        answers: answersOf(roundId, batch.answers),
      }),
  ),
  getRoundSummary: roundQuery(roundSummary),
  getRecords: query(records),
  getHistory: query(history),
  ...VOCAB_OPERATIONS,
  ...TALK_OPERATIONS,
};
