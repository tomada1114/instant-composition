import { z } from "zod";
import { category, count, id, number, object, text } from "./storage-common";

function taskSchema(strict: boolean) {
  const scene = object(
    { partner: text, place: text, relation: text, description: text },
    strict,
  );
  const judgment = object(
    { verdict: z.enum(["fine", "corrected"]), modelAnswer: text, point: text },
    strict,
  );
  const candidate = object(
    {
      category,
      headword: text,
      definition: text,
      example: text,
      example2: text,
      meaning: text,
      turn: count,
    },
    strict,
  );
  const key = object(
    {
      talkId: id,
      task: z.enum(["talk-scene", "talk-teacher", "talk-partner", "talk-cards"]),
      turn: count,
      promptVersion: id,
      generation: count.optional(),
    },
    strict,
  );
  const identity = {
    key,
    claimId: id,
    input: text,
    attempt: count.positive(),
    duplicatePossible: z.boolean(),
    startedAt: count,
    expiresAt: count,
  };
  const call = object(
    {
      provider: id,
      modelId: id,
      inputTokens: count,
      outputTokens: count,
      latencyMs: count,
      costUsd: number.nonnegative().nullable(),
    },
    strict,
  );
  const reply = object({ value: z.unknown(), call }, strict);
  const schemas = {
    "talk-scene": object({ scene, opening: text }, strict),
    "talk-teacher": judgment,
    "talk-partner": text,
    "talk-cards": z.array(candidate),
  };
  return z
    .discriminatedUnion("state", [
      object({ ...identity, state: z.literal("in-flight"), leaseUntil: count }, strict),
      object(
        {
          ...identity,
          state: z.literal("failed"),
          outcome: z.enum(["known", "unknown"]),
          reason: id,
        },
        strict,
      ),
      object({ ...identity, state: z.literal("result"), result: reply }, strict),
    ])
    .superRefine((task, ctx) => {
      if (task.state !== "result") return;
      if (!schemas[task.key.task].safeParse(task.result.value).success)
        ctx.addIssue({
          code: "custom",
          path: ["result", "value"],
          message: "Invalid stored task reply.",
        });
    })
    .transform((task) =>
      task.state !== "result"
        ? task
        : {
            ...task,
            result: {
              ...task.result,
              value: schemas[task.key.task].parse(task.result.value),
            },
          },
    );
}

export function modelTaskSchema(strict: boolean): ReturnType<typeof taskSchema> {
  return taskSchema(strict);
}
