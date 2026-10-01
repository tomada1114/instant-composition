import type {
  AbortSignalLike,
  LanguageModel,
  ModelCall,
  ModelFailure,
  ModelReply,
  ModelRequest,
} from "@instant-composition/application";
import { err, ok, type Result } from "@instant-composition/domain";

/** Each task's answer: the output a model would have returned, before `read` narrows it. */
export type StandInScript = Readonly<
  Record<string, (request: ModelRequest<unknown>) => unknown>
>;

/** A `LanguageModel` that calls nothing: what tests and a local run without a key use. */
export interface StandInModel extends LanguageModel {
  /** Every request it got, in order, the failed ones included. */
  readonly requests: readonly ModelRequest<unknown>[];
  /** Fails every later call with `reason`, until called again with `undefined`. */
  failWith(reason: ModelFailure["reason"] | undefined): void;
}

const CALL: ModelCall = {
  provider: "stand-in",
  modelId: "stand-in",
  inputTokens: 0,
  outputTokens: 0,
  latencyMs: 0,
  costUsd: 0,
};

const failure = (reason: ModelFailure["reason"]): Result<never, ModelFailure> =>
  err({ code: "ERR_MODEL_UNAVAILABLE", reason });

/**
 * A model answering each `task` from `script`, run through the request's
 * `read` as a provider's answer is, so a scripted value `read` refuses is
 * `malformed`. An aborted signal is `timeout`.
 *
 * A request for a task `script` does not hold rejects rather than failing:
 * a missing task is a mistake in the caller's wiring, not a model's answer.
 */
export function createStandInModel(script: StandInScript): StandInModel {
  const requests: ModelRequest<unknown>[] = [];
  let failing: ModelFailure["reason"] | undefined;

  function answer<T>(
    request: ModelRequest<T>,
    signal: AbortSignalLike,
  ): Result<ModelReply<T>, ModelFailure> {
    requests.push(request);
    const respond = Object.hasOwn(script, request.task)
      ? script[request.task]
      : undefined;
    if (respond === undefined) {
      throw new Error(
        `The stand-in model has no answer scripted for "${request.task}".`,
      );
    }
    if (signal.aborted) return failure("timeout");
    if (failing !== undefined) return failure(failing);
    const value = request.output.read(respond(request));
    return value === undefined ? failure("malformed") : ok({ value, call: CALL });
  }

  return {
    requests,
    failWith(reason) {
      failing = reason;
    },
    generate(request, signal) {
      return Promise.resolve().then(() => answer(request, signal));
    },
  };
}
