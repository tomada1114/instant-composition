import { z } from "zod";
import type { ModelTaskKey } from "@instant-composition/domain";
import { category, count, id, number, object, text } from "./storage-common";

function taskKeySchema(strict: boolean) {
  return object(
    {
      talkId: id,
      task: z.enum(["talk-scene", "talk-teacher", "talk-partner", "talk-cards"]),
      turn: count,
      promptVersion: id,
      generation: count.optional(),
    },
    strict,
  );
}

/** Optional generation is a distinct key component even when it is zero. */
export function modelTaskSortKey(task: ModelTaskKey): string {
  return `MODEL_TASK#${encodeURIComponent(task.talkId)}#${encodeURIComponent(task.task)}#${String(task.turn)}#${encodeURIComponent(task.promptVersion)}${task.generation === undefined ? "" : `#${String(task.generation)}`}`;
}

/** Native value validation may omit transport keys; actual rows bind both keys. */
export function modelTaskStorageKeyMatches(
  value: unknown,
  partition: string | undefined,
  sort: string | undefined,
): boolean {
  if (partition === undefined && sort === undefined) return true;
  if (
    partition === undefined ||
    sort === undefined ||
    !partition.startsWith("LEARNER#")
  )
    return false;
  if (typeof value !== "object" || value === null) return false;
  const key = taskKeySchema(true).safeParse(Reflect.get(value, "key"));
  if (!key.success) return false;
  const { generation, ...base } = key.data;
  try {
    const learner = decodeURIComponent(partition.slice("LEARNER#".length));
    return (
      learner.length > 0 &&
      partition === `LEARNER#${encodeURIComponent(learner)}` &&
      sort ===
        modelTaskSortKey({
          ...base,
          ...(generation === undefined ? {} : { generation }),
        })
    );
  } catch {
    return false;
  }
}

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
  const identity = {
    key: taskKeySchema(strict),
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
