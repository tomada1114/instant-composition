import type {
  AbortSignalLike,
  LanguageModel,
  ModelCall,
  ModelFailure,
  ModelReply,
  ModelRequest,
} from "@instant-composition/application";
import type { Result } from "@instant-composition/domain";

import type { LogSink, ModelCallOutcome } from "./log";

/** The model a run serves talks with, and who serves it, which a failed call's line still names. */
export interface ServedModel {
  readonly provider: string;
  readonly modelId: string;
  readonly model: LanguageModel;
}

/** What one request's model calls are logged against. */
export interface ModelCallLog {
  readonly requestId: string;
  readonly log: LogSink;
  /** Epoch milliseconds: the edge's own measure of a call that produced no answer. */
  readonly now: () => number;
}

/**
 * `served.model`, writing one `kind: "model-call"` line per call to
 * `request.log` and changing nothing it answers.
 *
 * @remarks
 * The line names the task and its prompt version, never the request's text or
 * the answer. A call that throws — a key that could not be read — is logged as
 * `failed` and the error rethrown, so the request still ends as the bare 500
 * its log line names by class.
 */
export function loggedModel(served: ServedModel, request: ModelCallLog): LanguageModel {
  function write(
    asked: ModelRequest<unknown>,
    outcome: ModelCallOutcome,
    started: number,
    call?: ModelCall,
  ): void {
    request.log({
      kind: "model-call",
      requestId: request.requestId,
      task: asked.task,
      promptVersion: asked.promptVersion,
      provider: call?.provider ?? served.provider,
      modelId: call?.modelId ?? served.modelId,
      outcome,
      inputTokens: call?.inputTokens ?? null,
      outputTokens: call?.outputTokens ?? null,
      latencyMs: call?.latencyMs ?? request.now() - started,
      costUsd: call?.costUsd ?? null,
    });
  }

  return {
    async generate<T>(
      asked: ModelRequest<T>,
      signal: AbortSignalLike,
    ): Promise<Result<ModelReply<T>, ModelFailure>> {
      const started = request.now();
      let result: Result<ModelReply<T>, ModelFailure>;
      try {
        result = await served.model.generate(asked, signal);
      } catch (error) {
        write(asked, "failed", started);
        throw error;
      }
      if (result.ok) {
        write(asked, "ok", started, result.value.call);
      } else {
        write(asked, result.error.reason, started);
      }
      return result;
    },
  };
}
