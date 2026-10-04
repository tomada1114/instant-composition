import {
  decideModelTask,
  err,
  ok,
  type ModelTask,
  type ModelTaskKey,
  type Result,
} from "@instant-composition/domain";

import type { RequestContext } from "./context";
import type { ModelFailure, ModelReply } from "./language-model";
import type { Commit, CommitConflict, LearnerStore } from "./store";
import { ask, type TalkDeps, type TalkRequest } from "./talk-model";

/** A job already answered, or the version that fences its one executor. */
export type ReservedModel =
  | { readonly kind: "result"; readonly result: unknown }
  | {
      readonly kind: "claim";
      readonly task: Extract<ModelTask, { state: "in-flight" }>;
      readonly version: number;
    };

/** Pending work is temporary unavailability; a changed input is a conflict. */
export type ModelTaskError =
  | ModelFailure
  | CommitConflict
  | { readonly code: "ERR_MODEL_UNAVAILABLE"; readonly reason: "in-flight" };

/** The exact request identity, excluding the reader function and per-attempt metadata. */
function inputOf(request: TalkRequest<unknown>): string {
  return JSON.stringify({
    system: request.system,
    messages: request.messages,
    output: { name: request.output.name, schema: request.output.schema },
    temperature: request.temperature,
    maxOutputTokens: request.maxOutputTokens,
  });
}

/**
 * Claims all calls of one step together, after checking the talk snapshot.
 * Teacher and partner therefore cannot be split between racing requests.
 */
export async function reserveModels(
  store: LearnerStore,
  context: RequestContext,
  tasks: readonly {
    readonly key: ModelTaskKey;
    readonly request: TalkRequest<unknown>;
  }[],
  expect: Commit["expect"],
): Promise<Result<readonly ReservedModel[], ModelTaskError>> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const records = await Promise.all(tasks.map(({ key }) => store.modelTask(key)));
    const puts: Commit["puts"][number][] = [];
    const updates: Commit["updates"][number][] = [];
    const reserved: ReservedModel[] = [];
    for (const [index, { key, request }] of tasks.entries()) {
      const stored = records[index];
      const decision = decideModelTask(
        stored?.value,
        key,
        inputOf(request),
        context.now,
        context.requestId,
      );
      if (decision.kind === "mismatch") return err({ code: "ERR_CONFLICT" });
      if (decision.kind === "busy")
        return err({ code: "ERR_MODEL_UNAVAILABLE", reason: "in-flight" });
      if (decision.kind === "result") {
        reserved.push(decision);
      } else {
        const entry = { type: "modelTask" as const, value: decision.task };
        if (stored === undefined) puts.push(entry);
        else
          updates.push({
            entry,
            version: stored.version,
            modelClaim: stored.value.claimId,
          });
        reserved.push({
          kind: "claim",
          task: decision.task,
          version: (stored?.version ?? 0) + 1,
        });
      }
    }
    const committed = await store.commit({ puts, updates, expect });
    if (committed.ok) return ok(reserved);
  }
  return err({ code: "ERR_CONFLICT" });
}

async function finish(
  store: LearnerStore,
  reservation: Extract<ReservedModel, { kind: "claim" }>,
  ending:
    | { readonly state: "result"; readonly result: unknown }
    | {
        readonly state: "failed";
        readonly outcome: "known" | "unknown";
        readonly reason: string;
      },
): Promise<Result<undefined, CommitConflict>> {
  const { key, claimId, input, attempt, duplicatePossible, startedAt, expiresAt } =
    reservation.task;
  const identity = {
    key,
    claimId,
    input,
    attempt,
    duplicatePossible,
    startedAt,
    expiresAt,
  };
  return store.commit({
    puts: [],
    updates: [
      {
        entry: { type: "modelTask", value: { ...identity, ...ending } },
        version: reservation.version,
        modelClaim: reservation.task.claimId,
      },
    ],
    expect: [],
  });
}

/** Runs only a reserved call; saved results are trusted store data under the exact request version. */
export async function askReserved<T>(
  deps: TalkDeps,
  store: LearnerStore,
  reservation: ReservedModel,
  request: TalkRequest<T>,
): Promise<Result<ModelReply<T>, ModelTaskError>> {
  if (reservation.kind === "result") return ok(reservation.result as ModelReply<T>);
  let reply: Result<ModelReply<T>, ModelFailure>;
  try {
    reply = await ask(deps, {
      ...request,
      execution: {
        attempt: reservation.task.attempt,
        duplicatePossible: reservation.task.duplicatePossible,
      },
    });
  } catch (error) {
    await finish(store, reservation, {
      state: "failed",
      outcome: "unknown",
      reason: "crash",
    });
    throw error;
  }
  const written = await finish(
    store,
    reservation,
    reply.ok
      ? { state: "result", result: reply.value }
      : {
          state: "failed",
          outcome:
            reply.error.reason === "timeout" || reply.error.reason === "transport"
              ? "unknown"
              : "known",
          reason: reply.error.reason,
        },
  );
  return written.ok ? reply : written;
}
