import type * as z from "zod";

import type { ErrorCode } from "./errors";
import {
  historySchema,
  homeViewSchema,
  recordsViewSchema,
  settingsPageViewSchema,
} from "./query-views";
import {
  answersRequestSchema,
  settingsPatchSchema,
  startRoundRequestSchema,
} from "./requests";
import { roundPayloadSchema, roundSummarySchema, settingsViewSchema } from "./views";

export interface Route {
  readonly method: "get" | "post" | "patch";
  /** Relative to the `/api` root: a client calls `/api` + this path. */
  readonly path: string;
  readonly operationId: string;
  readonly summary: string;
  readonly requestBody: z.ZodType | null;
  /** The success status, and the body it carries; `null` for none. */
  readonly success: { readonly status: 200 | 204; readonly body: z.ZodType | null };
  /** Every code this operation may answer with, beyond a transport failure. */
  readonly errors: readonly ErrorCode[];
}

/** Every operation reads a learner-bound store, which the policy may refuse. */
const QUERY_ERRORS = ["ERR_FORBIDDEN"] as const;

/** A path's `{roundId}` is validated like a body field. */
const ROUND_QUERY_ERRORS = [
  "ERR_BAD_REQUEST",
  "ERR_FORBIDDEN",
  "ERR_ROUND_NOT_FOUND",
] as const;

/** A command reads a body, commits conditionally and may need the catalog. */
const COMMAND_ERRORS = [
  "ERR_BAD_REQUEST",
  "ERR_PAYLOAD_TOO_LARGE",
  "ERR_FORBIDDEN",
  "ERR_CONFLICT",
  "ERR_CONTENT_UNREADABLE",
] as const;

/**
 * The `/v1` operations the commands and queries in `packages/application`
 * back today (ADR-0007). `/v1/me` arrives with learner registration and
 * `GET /v1/rounds/{roundId}` with the offline answer queue.
 */
export const ROUTES: readonly Route[] = [
  {
    method: "get",
    path: "/v1/settings",
    operationId: "getSettings",
    summary: "The settings as saved, the topics to choose from and the difficulty now.",
    requestBody: null,
    success: { status: 200, body: settingsPageViewSchema },
    errors: QUERY_ERRORS,
  },
  {
    method: "patch",
    path: "/v1/settings",
    operationId: "updateSettings",
    summary: "Changes the fields the body sets.",
    requestBody: settingsPatchSchema,
    success: { status: 200, body: settingsViewSchema },
    errors: COMMAND_ERRORS,
  },
  {
    method: "get",
    path: "/v1/home",
    operationId: "getHome",
    summary: "The home view: today's portion, the streak and the next action.",
    requestBody: null,
    success: { status: 200, body: homeViewSchema },
    errors: QUERY_ERRORS,
  },
  {
    method: "post",
    path: "/v1/rounds",
    operationId: "startRound",
    summary:
      "Starts a round of the kind asked for, or resumes today's open one; a retried start with the same roundId answers the round it made.",
    requestBody: startRoundRequestSchema,
    success: { status: 200, body: roundPayloadSchema },
    errors: [...COMMAND_ERRORS, "ERR_ROUND_CLOSED", "ERR_NOT_ENOUGH_CARDS"],
  },
  {
    method: "post",
    path: "/v1/rounds/{roundId}/answers",
    operationId: "recordAnswers",
    summary: "Records a batch of answers; ids the round already holds are ignored.",
    requestBody: answersRequestSchema,
    success: { status: 204, body: null },
    errors: [...COMMAND_ERRORS, "ERR_ROUND_NOT_FOUND", "ERR_ROUND_CLOSED"],
  },
  {
    method: "post",
    path: "/v1/rounds/{roundId}/finish",
    operationId: "finishRound",
    summary:
      "Records the round's last answers and closes it; a finished round answers the summary it kept.",
    requestBody: answersRequestSchema,
    success: { status: 200, body: roundSummarySchema },
    errors: [...COMMAND_ERRORS, "ERR_ROUND_NOT_FOUND", "ERR_ROUND_CLOSED"],
  },
  {
    method: "get",
    path: "/v1/rounds/{roundId}/summary",
    operationId: "getRoundSummary",
    summary: "The kept summary of a finished round; a round not finished is not found.",
    requestBody: null,
    success: { status: 200, body: roundSummarySchema },
    errors: ROUND_QUERY_ERRORS,
  },
  {
    method: "get",
    path: "/v1/records",
    operationId: "getRecords",
    summary:
      "The records view: mastery by topic, the run, the calendar and the totals.",
    requestBody: null,
    success: { status: 200, body: recordsViewSchema },
    errors: QUERY_ERRORS,
  },
  {
    method: "get",
    path: "/v1/history",
    operationId: "getHistory",
    summary:
      "What the card-planning tooling reads: the cards seen, the choices and the level.",
    requestBody: null,
    success: { status: 200, body: historySchema },
    errors: QUERY_ERRORS,
  },
];
