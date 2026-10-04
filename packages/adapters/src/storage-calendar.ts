import { z } from "zod";
import { count, day, id, number, object, text } from "./storage-common";

function calendarSchemas(strict: boolean) {
  const schema = z.literal(1),
    version = count.nullable(),
    cursor = id.nullable();
  const identity = {
    day,
    epoch: count,
    catalogVersion: id,
    settingsVersion: version,
    statsVersion: version,
    portionVersion: version,
    tallyVersion: version,
  };
  const map = z.record(id, count);
  const ranked = object(
    { id, scheduled: z.boolean(), recall: number.min(0).max(1), at: number },
    strict,
  );
  const evidence = object({ seen: count, misses: count }, strict).refine(
    (value) => value.misses <= value.seen,
  );
  const weakness = { seen: count, misses: count, rate: number.min(0).max(1) };
  const run = object({ schema, start: day, end: day }, strict).refine(
    (value) => value.start <= value.end,
  );
  return {
    compositionSource: object({ schema, epoch: count }, strict),
    compositionReadModel: object(
      {
        schema,
        generation: id,
        expiresAt: count.optional(),
        ...identity,
        available: count,
        preview: object(
          {
            size: count,
            setting: count,
            shortage: z.boolean(),
            reviewCount: count,
            newCount: count,
            focusNames: z.array(text),
            weakNames: z.array(text),
            minutes: number.min(0),
          },
          strict,
        ).nullable(),
        reach: map,
        breakdown: map,
        pending: count,
        weak: object(
          {
            grammar: z.array(object({ concept: id, ...weakness }, strict)),
            subtopics: z.array(
              object({ topic: id, subtopic: id, ...weakness }, strict),
            ),
          },
          strict,
        ),
      },
      strict,
    ),
    compositionBuild: object(
      {
        schema,
        generation: id,
        expiresAt: count.optional(),
        ...identity,
        phase: z.enum(["items", "ranks"]),
        cursor,
        known: text.regex(/^[01]*$/),
        answered: count,
        newAnswered: count,
        due: count,
        notDue: count,
        notDueTop: z.array(ranked).max(5),
        conceptFirst: z.record(id, ranked),
        conceptRanks: map,
        notDueConceptFirst: z.record(id, ranked),
        notDueConceptRanks: map,
        concepts: z.record(id, evidence),
        subtopics: z.record(id, evidence),
        reach: map,
        breakdown: map,
        pending: count,
      },
      strict,
    ),
    compositionCandidate: ranked.extend({
      schema,
      day,
      generation: id,
      mode: z.enum(["due", "notDue"]),
      order: id,
      expiresAt: count.optional(),
    }),
    streakRun: run,
    streakMigration: object(
      {
        schema,
        statsVersion: count,
        legacyCursor: count.nullable(),
        cursor,
        open: run.nullable(),
        longest: count,
      },
      strict,
    ),
  };
}
export function compositionReadModelSchemas(
  strict: boolean,
): ReturnType<typeof calendarSchemas> {
  return calendarSchemas(strict);
}
