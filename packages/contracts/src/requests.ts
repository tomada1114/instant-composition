import * as z from "zod";

import {
  answerResultSchema,
  dailySizeSchema,
  drillNewPerDaySchema,
  drillReviewsPerDaySchema,
  gradeKeysPatchSchema,
  gradeSchema,
  idSchema,
  levelSchema,
  limitSecondsSchema,
  passSchema,
  roundKindSchema,
  subtopicRefSchema,
  vocabNewPerDaySchema,
  vocabReviewsPerDaySchema,
} from "./primitives";

/**
 * The most answers one request carries. A round with re-asks can hold more,
 * so a client sends what is not yet recorded in batches of at most this many.
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
 * One graded card; the round comes from the path. It carries a `grade` with
 * `timedOut`, or an older client's `result` in their place: `ok` is taken as
 * good, `ng` as again and `timeout` as again timed out; one with neither is
 * refused. `answeredAt` is when the learner answered, in epoch milliseconds on
 * the client's clock: the server holds it between the round's start and its
 * own time rather than refusing it, and takes its own time when it is absent.
 * `elapsedMs` is held the same way, to the round's limit, never refused for
 * running over.
 */
export const answerSchema = z
  .object({
    /** Made by the client; a repeated id is ignored, which is what makes a resend safe. */
    id: idSchema,
    cardId: idSchema,
    pass: passSchema,
    /** An older client's grade; ignored when `grade` is present. */
    result: answerResultSchema.exactOptional(),
    grade: gradeSchema.exactOptional(),
    /** The timer ran out before the flip; the grade still sets the schedule. */
    timedOut: z.boolean().exactOptional(),
    elapsedMs: z.int().min(0),
    answeredAt: z.int().min(0).exactOptional(),
  })
  .refine((answer) => answer.grade !== undefined || answer.result !== undefined);

/** `POST /v1/rounds/{roundId}/answers` and `…/finish`: a batch, so a replay is the same call. */
export const answersRequestSchema = z.object({
  answers: z.array(answerSchema).max(MAX_ROUND_ANSWERS),
});

/** `PATCH /v1/settings`: only the fields present change. */
export const settingsPatchSchema = z.object({
  topics: z.array(idSchema).max(MAX_SETTINGS_LIST).exactOptional(),
  focus: z.array(subtopicRefSchema).max(MAX_SETTINGS_LIST).exactOptional(),
  /** Kept for the clients that set it; it no longer sizes a deal. */
  dailySize: dailySizeSchema.exactOptional(),
  sound: z.boolean().exactOptional(),
  /** Taken by the next round dealt; the round under way keeps the limit it was dealt with. */
  limitSeconds: limitSecondsSchema.exactOptional(),
  /** Every key at once, so they are judged together; without `hard`, it is derived. */
  gradeKeys: gradeKeysPatchSchema.exactOptional(),
  /** Taken by the next deal; today's portion is retargeted, never below its progress. */
  newPerDay: drillNewPerDaySchema.exactOptional(),
  /** As `newPerDay`; `null` is no limit. */
  reviewsPerDay: drillReviewsPerDaySchema.exactOptional(),
  /** Taken by the next vocabulary deal. */
  vocabNewPerDay: vocabNewPerDaySchema.exactOptional(),
  /** Taken by the next vocabulary deal; `null` is no limit. */
  vocabReviewsPerDay: vocabReviewsPerDaySchema.exactOptional(),
});

/**
 * `PATCH /v1/level`: back to `auto`, which adjusts from the level as it is,
 * or `manual` at the level picked, which no round's answers move. The level
 * must be on the catalog's scale, which the command checks.
 */
export const levelChoiceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("auto") }),
  z.object({ mode: z.literal("manual"), level: levelSchema }),
]);

/**
 * The UI locales there is a catalog for, one per `messages/<locale>.json`.
 * This package imports only zod, so the list is written out;
 * `tests/messages.test.ts` holds it to the files.
 */
export const UI_LOCALES = ["ja"] as const;

/** A BCP 47 language tag, bounded; which ones are served is the catalog's to say. */
const languageTagSchema = z.string().min(1).max(35);

/**
 * `PATCH /v1/me`: only the fields present change. The time zone must be an
 * IANA zone and the languages the pair the catalog serves, which the command
 * checks; the UI locale must have a catalog.
 */
export const profilePatchSchema = z.object({
  timeZone: z.string().min(1).max(64).exactOptional(),
  l1: languageTagSchema.exactOptional(),
  target: languageTagSchema.exactOptional(),
  uiLocale: z.enum(UI_LOCALES).exactOptional(),
});
