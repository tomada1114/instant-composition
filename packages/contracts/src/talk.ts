import * as z from "zod";

import { idSchema, vocabCategorySchema } from "./primitives";

/**
 * The talk activity's request and response schemas. This package imports only
 * zod, so the domain's bounds are written out; `tests/contracts-schemas.test.ts`
 * holds them to `TALK_TUNING` and each view to the type it mirrors.
 */

/** The most characters the learner's Japanese or English may hold: `TALK_TUNING.maxChars`. */
export const MAX_TALK_TEXT = 300;

/** Turns in a talk: `TALK_TUNING.turns`. */
export const TALK_TURNS = 6;

/** The `{talkId}` path parameter. */
export const talkIdParamSchema = idSchema;

/** A turn's number, 1 to {@link TALK_TURNS}; also the `{turn}` path parameter. */
export const turnSchema = z.int().min(1).max(TALK_TURNS);

const talkTextSchema = z.string().min(1).max(MAX_TALK_TEXT);

/** `POST /v1/talks`: the talk id is the client's, so a retried start opens one talk. */
export const startTalkRequestSchema = z.object({ talkId: idSchema });

/**
 * `POST /v1/talks/{talkId}/turns`: what the learner wanted to say, and their
 * English, or `null` when they gave up. English holding a Japanese character
 * is refused by the command, as the field refuses it.
 */
export const turnRequestSchema = z.object({
  turn: turnSchema,
  japanese: talkTextSchema,
  english: talkTextSchema.nullable(),
});

/** `POST /v1/talks/{talkId}/turns/{turn}/recital`: how often the model answer was looked at again. */
export const recitalRequestSchema = z.object({ revealCount: z.int().min(0) });

/** Who the partner is, where, and how they are related; Japanese, as the model wrote it. */
export const sceneSchema = z.object({
  partner: z.string(),
  place: z.string(),
  relation: z.string(),
  /** One or two lines, shown above the talk. */
  description: z.string(),
});

/** `POST /v1/talks`: the scene and the partner's opening line. */
export const talkOpenedSchema = z.object({
  talkId: z.string(),
  scene: sceneSchema,
  opening: z.string(),
});

/** `fine` is the ○, `corrected` a correction, `failed` a teacher that answered nothing. */
export const verdictSchema = z.enum(["fine", "corrected", "failed"]);

export const judgmentSchema = z.object({
  verdict: verdictSchema,
  /** Empty unless `corrected`. */
  modelAnswer: z.string(),
  /** One line of Japanese naming the key phrase; empty unless `corrected`. */
  point: z.string(),
});

/** The partner's reply to a turn; `closing` on the last turn's. */
export const partnerReplySchema = z.object({ line: z.string(), closing: z.boolean() });

/** `POST /v1/talks/{talkId}/turns`: the judgment, and the reply when its call succeeded. */
export const turnResultSchema = z.object({
  judgment: judgmentSchema,
  reply: partnerReplySchema.nullable(),
});

/** `GET /v1/talks/{talkId}`: public state for the signed-in learner's own talk. */
export const talkViewSchema = talkOpenedSchema.extend({
  status: z.enum(["open", "finished", "ended", "discarded"]),
  turns: z.array(
    z.object({
      turn: turnSchema,
      japanese: z.string(),
      english: z.string().nullable(),
      judgment: judgmentSchema,
      reply: z.string().nullable(),
      closing: z.boolean(),
    }),
  ),
});

/** `POST /v1/talks/{talkId}/end`: whether the talk is kept as a record. */
export const talkEndedSchema = z.object({ kept: z.boolean() });

/**
 * `POST /v1/talks/{talkId}/cards`: the candidates to add, by their index in
 * the list; one already added is not added again.
 */
export const addCardsRequestSchema = z.object({
  candidates: z.array(z.int().min(0)).min(1).max(TALK_TURNS),
});

/** One card a talk's end offers, as the learner picks it. */
export const cardCandidateSchema = z.object({
  /** What `…/cards` names it by. */
  index: z.int().min(0),
  /** The corrected turn it came from. */
  turn: turnSchema,
  /**
   * The card it is answered as — a catalog card or one of the learner's own
   * holding the same headword — or the card it became once added; null for a
   * new one not added yet.
   */
  cardId: z.string().nullable(),
  /** The text is a catalog card's rather than the model's. */
  catalog: z.boolean(),
  category: vocabCategorySchema,
  headword: z.string(),
  definition: z.string(),
  /** Its blanks marked `{{…}}`, as a vocabulary card's. */
  example: z.string(),
  example2: z.string(),
  /** In the learner's first language. */
  meaning: z.string(),
  /** Its card has been answered at least once: 学習中. */
  inLearning: z.boolean(),
  /** Added from this talk: 追加済み. */
  added: z.boolean(),
});

/** `POST /v1/talks/{talkId}/candidates` and `…/cards`: the talk's candidates, in order. */
export const cardCandidatesSchema = z.object({
  candidates: z.array(cardCandidateSchema),
});
