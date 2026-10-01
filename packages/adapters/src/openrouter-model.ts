import type {
  LanguageModel,
  ModelFailure,
  ModelReply,
  ModelRequest,
} from "@instant-composition/application";
import { err, ok, type Result } from "@instant-composition/domain";

import { contentOf, parsedContent, usageOf } from "./openrouter-reply";

/** How the adapter reaches OpenRouter: `fetch` on a run, a fake in a test. */
export type Fetch = (request: Request) => Promise<Response>;

export interface OpenRouterOptions {
  readonly fetch: Fetch;
  /**
   * The API key, asked for on every call, so a hosted entry can read it from
   * Parameter Store each time and a rotated key reaches a running process.
   */
  readonly apiKey: () => Promise<string>;
  /** The OpenRouter model id, such as `anthropic/claude-haiku-4.5`. */
  readonly modelId: string;
  /** Milliseconds on a monotonic clock, for `latencyMs`; `performance.now()` when omitted. */
  readonly now?: () => number;
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

type Generated<T> = Result<ModelReply<T>, ModelFailure>;

const failure = (reason: ModelFailure["reason"]): Result<never, ModelFailure> =>
  err({ code: "ERR_MODEL_UNAVAILABLE", reason });

/** The OpenAI-compatible body, routed only to an endpoint that honors the schema and keeps no data. */
function bodyOf(modelId: string, request: ModelRequest<unknown>): string {
  return JSON.stringify({
    model: modelId,
    messages: [
      { role: "system", content: request.system },
      ...request.messages.map((message) => ({
        role: message.role,
        content: message.text,
      })),
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: request.output.name,
        strict: true,
        schema: request.output.schema,
      },
    },
    provider: { require_parameters: true, data_collection: "deny" },
    temperature: request.temperature,
    max_tokens: request.maxOutputTokens,
  });
}

function refusalOf(status: number): ModelFailure["reason"] {
  if (status === 429) return "throttled";
  if (status === 401 || status === 403) return "denied";
  return "transport";
}

/** `timeout` once the call was aborted, since an abort is what made it fail; `otherwise` before. */
function failedAs(
  signal: AbortSignal,
  otherwise: ModelFailure["reason"],
): Result<never, ModelFailure> {
  return failure(signal.aborted ? "timeout" : otherwise);
}

async function exchange<T>(
  options: OpenRouterOptions,
  request: ModelRequest<T>,
  signal: AbortSignal,
): Promise<Generated<T>> {
  const key = await options.apiKey();
  if (signal.aborted) return failure("timeout");
  const now = options.now ?? (() => performance.now());
  const started = now();
  let response: Response;
  try {
    response = await options.fetch(
      new Request(ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: bodyOf(options.modelId, request),
        signal,
      }),
    );
  } catch {
    return failedAs(signal, "transport");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return failure(refusalOf(response.status));
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return failedAs(signal, "transport");
  }
  const latencyMs = Math.round(now() - started);
  const content = contentOf(body);
  const parsed = content === undefined ? undefined : parsedContent(content);
  const value = parsed === undefined ? undefined : request.output.read(parsed.value);
  if (value === undefined) return failure("malformed");
  return ok({
    value,
    call: {
      provider: "openrouter",
      modelId: options.modelId,
      latencyMs,
      ...usageOf(body),
    },
  });
}

/**
 * The `LanguageModel` served by OpenRouter's chat completions, with the task's
 * schema as its structured output.
 *
 * @remarks
 * A 429 is `throttled`, a 401 or 403 `denied`, and an unreachable endpoint or
 * any other refusal `transport`. An answer whose content is not JSON, or that
 * `read` refuses, is `malformed`. When `signal` aborts, the request is aborted
 * with it and the call is `timeout`. It writes no log: the call record is
 * returned, and the caller writes the line.
 *
 * @throws Whatever `options.apiKey` throws: a key that cannot be read is the
 * caller's configuration, not the provider's answer.
 */
export function createOpenRouterModel(options: OpenRouterOptions): LanguageModel {
  return {
    async generate(request, signal) {
      if (signal.aborted) return failure("timeout");
      const controller = new AbortController();
      const abort = (): void => {
        controller.abort();
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        return await exchange(options, request, controller.signal);
      } finally {
        signal.removeEventListener("abort", abort);
      }
    },
  };
}
