import { z } from "zod";
import {
  commonSchemas,
  count,
  day,
  grade,
  id,
  object,
  pass,
  result,
  text,
} from "./storage-common";
import { profileSchemas } from "./storage-profile";
import { outcomeSchema } from "./storage-outcome";

function makeCompositionSchemas(strict: boolean, storageVersion = 1) {
  const common = commonSchemas(strict);
  const detail = object(
    {
      activity: z.literal("composition"),
      pass,
      result,
      grade: grade.optional(),
      timedOut: z.boolean().optional(),
      elapsedMs: count,
      limitMs: count,
      paceMs: count.optional(),
    },
    strict,
  );
  return {
    ...profileSchemas(strict),
    stats: object(
      {
        points: count,
        completedDays: z.array(day).optional(),
        streak: object({ schema: z.literal(1), longest: count }, strict).optional(),
        firstDay: day.nullable(),
        said: count,
        practicedDays: count,
        level: object(
          {
            level: count,
            reason: z.enum(["placement", "up", "down", "chosen"]),
            roundId: id.nullable(),
            at: count,
          },
          strict,
        ).nullable(),
        levelMode: z.enum(["auto", "manual"]).optional(),
        levelWindow: z.array(
          object(
            {
              cardId: id.optional(),
              level: count,
              result,
              elapsedMs: count,
              answeredAt: count,
              paceMs: count.optional(),
              limitMs: count,
            },
            strict,
          ),
        ),
        openRound: object({ id, day }, strict).nullable(),
        titles: z.array(id),
      },
      strict,
    ).refine(
      (value) =>
        (storageVersion >= 4 || value.streak === undefined) &&
        (value.completedDays !== undefined ||
          (storageVersion >= 4 && value.streak !== undefined)),
    ),
    round: object(
      {
        id,
        kind: z.enum(["placement", "today", "yesterday", "extra"]),
        day,
        portionDay: day.nullable(),
        deck: z.array(id),
        limitMs: count.optional(),
        startedAt: count,
        finishedAt: count.nullable(),
        abandonedAt: count.nullable(),
        firstPass: count,
        answerState: object(
          { firstCards: z.array(id), cursor: id.nullable(), complete: z.boolean() },
          strict,
        ).optional(),
        outcome: outcomeSchema(strict).nullable(),
      },
      strict,
    ).refine((value) => storageVersion >= 2 || value.answerState === undefined),
    review: object(
      {
        id,
        item: common.item,
        sessionId: id,
        answeredAt: count,
        revision: count.optional(),
        day,
        outcome: z.enum(["again", "hard", "good", "easy"]),
        before: common.memory.nullable(),
        after: common.memory.nullable(),
        fsrs: object(
          { before: common.fsrs.nullable(), after: common.fsrs.nullable() },
          strict,
        ).optional(),
        snapshot: object(
          { topic: id, subtopic: id, level: count, prompt: text.nullable() },
          strict,
        ),
        detail,
      },
      strict,
    ),
    portion: object(
      {
        day,
        target: count,
        progress: count,
        completedAt: count.nullable(),
        completedRound: id.nullable(),
      },
      strict,
    ),
    day: object(
      {
        day,
        answers: count,
        firstPass: count,
        roundsStarted: count,
        roundsFinished: count,
        lastFinishedRound: id.nullable(),
      },
      strict,
    ),
    item: object(
      {
        item: common.item,
        revision: count.optional(),
        memory: common.memory.optional(),
        fsrs: common.fsrs.optional(),
        okDays: z.array(day),
        mastered: object({ day, sessionId: id }, strict).nullable(),
        placement: common.placement,
        last: common.mark.nullable(),
        previous: common.mark.nullable(),
      },
      strict,
    ),
  };
}

export function compositionSchemas(
  strict: boolean,
  storageVersion = 1,
): ReturnType<typeof makeCompositionSchemas> {
  return makeCompositionSchemas(strict, storageVersion);
}
