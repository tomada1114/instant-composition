import { z } from "zod";
import {
  category,
  commonSchemas,
  count,
  day,
  grade,
  id,
  object,
  pass,
  text,
} from "./storage-common";

function makeVocabularySchemas(strict: boolean) {
  const { fsrs } = commonSchemas(strict);
  const source = object({ kind: z.literal("talk"), talkId: id, turn: count }, strict);
  return {
    vocabItem: object(
      {
        cardId: id,
        source: z.union([object({ kind: z.literal("catalog") }, strict), source]),
        state: fsrs.nullable(),
        firstDay: day.nullable(),
      },
      strict,
    ),
    vocabSession: object(
      {
        id,
        kind: z.enum(["today", "extra", "weak"]),
        category: category.nullable(),
        day,
        deck: z.array(id),
        startedAt: count,
        finishedAt: count.nullable(),
        tomorrow: count.nullable(),
      },
      strict,
    ),
    vocabReview: object(
      {
        id,
        sessionId: id,
        cardId: id,
        answeredAt: count,
        day,
        pass,
        grade,
        elapsedMs: count,
        before: fsrs.nullable(),
        after: fsrs.nullable(),
        snapshot: object(
          { headword: text, meaning: text, category, level: count },
          strict,
        ),
      },
      strict,
    ),
    card: object(
      {
        id,
        target: id,
        l1: id,
        category,
        level: count,
        headword: text,
        definition: text,
        example: text,
        example2: text,
        meaning: text,
        source,
        createdAt: count,
      },
      strict,
    ),
  };
}

function makeTalkSchema(strict: boolean) {
  const card = {
    category,
    headword: text,
    definition: text,
    example: text,
    example2: text,
    meaning: text,
  };
  return object(
    {
      id,
      status: z.enum(["open", "finished", "ended", "discarded"]),
      startedAt: count,
      endedAt: count.optional(),
      expiresAt: count.optional(),
      scene: object(
        { partner: text, place: text, relation: text, description: text },
        strict,
      ),
      opening: text,
      turns: z.array(
        object(
          {
            n: count,
            partnerLine: text,
            japanese: text,
            english: text.nullable(),
            judgment: object(
              {
                verdict: z.enum(["fine", "corrected", "failed"]),
                modelAnswer: text,
                point: text,
              },
              strict,
            ),
            reply: text.optional(),
            revealCount: count.optional(),
          },
          strict,
        ),
      ),
      model: object(
        {
          provider: id,
          modelId: id,
          prompts: object(
            {
              "talk-scene": id.optional(),
              "talk-teacher": id.optional(),
              "talk-partner": id.optional(),
              "talk-cards": id.optional(),
            },
            strict,
          ),
        },
        strict,
      ),
      cards: object(
        {
          promptVersion: id,
          candidates: z.array(object({ ...card, turn: count }, strict)),
          added: z.array(object({ index: count, cardId: id }, strict)),
        },
        strict,
      ).optional(),
    },
    strict,
  );
}

export function vocabularySchemas(
  strict: boolean,
): ReturnType<typeof makeVocabularySchemas> {
  return makeVocabularySchemas(strict);
}
export function talkSchema(strict: boolean): ReturnType<typeof makeTalkSchema> {
  return makeTalkSchema(strict);
}
