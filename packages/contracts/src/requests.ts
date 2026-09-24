import * as z from "zod";

import {
  answerResultSchema,
  dailySizeSchema,
  idSchema,
  passSchema,
  roundKindSchema,
  subtopicRefSchema,
} from "./primitives";

/**
 * Two passes over the largest deck is the most a round can hold: twice the
 * largest of the domain's `TUNING.dailySizes`. This package imports only zod,
 * so the value is written out; `tests/contracts-schemas.test.ts` holds it to
 * the domain's.
 */
export const MAX_ROUND_ANSWERS = 60;

/** The most topics or focus subtopics one settings patch may name. */
const MAX_SETTINGS_LIST = 50;

/** The `{roundId}` path parameter. */
export const roundIdParamSchema = idSchema;

/** `POST /v1/rounds`: the round id is the client's, so a retried start opens one round. */
export const startRoundRequestSchema = z.object({
  roundId: idSchema,
  kind: roundKindSchema,
});

/**
 * One graded card. The round comes from the path and the time from the
 * server, which stamps `answeredAt` itself.
 */
export const answerSchema = z.object({
  /** Made by the client; a repeated id is ignored, which is what makes a resend safe. */
  id: idSchema,
  cardId: idSchema,
  pass: passSchema,
  result: answerResultSchema,
  elapsedMs: z.int().min(0).max(600_000),
});

/** `POST /v1/rounds/{roundId}/answers` and `…/finish`: a batch, so a replay is the same call. */
export const answersRequestSchema = z.object({
  answers: z.array(answerSchema).max(MAX_ROUND_ANSWERS),
});

/** `PATCH /v1/settings`: only the fields present change. */
export const settingsPatchSchema = z.object({
  topics: z.array(idSchema).max(MAX_SETTINGS_LIST).exactOptional(),
  focus: z.array(subtopicRefSchema).max(MAX_SETTINGS_LIST).exactOptional(),
  dailySize: dailySizeSchema.exactOptional(),
  sound: z.boolean().exactOptional(),
});
