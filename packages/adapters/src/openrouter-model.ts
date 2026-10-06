import type {
  LanguageModel,
  ModelFailure,
  ModelReply,
  ModelRequest,
  ModelRequestFailure,
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

const failure = (
  reason: ModelFailure["reason"],
  detail: Pick<ModelFailure, "httpStatus" | "requestFailure" | "causeCode"> = {},
): Result<never, ModelFailure> =>
  err({ code: "ERR_MODEL_UNAVAILABLE", reason, ...detail });

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

const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/**
 * The code `fetch` put on what it threw — undici's `TypeError` carries it on
 * `cause`, or on the first of an `AggregateError`'s `errors` — when it has the
 * shape of an identifier. Only that shape is kept: a message, which can quote
 * a header or a host, never reaches the failure.
 */
function causeCodeOf(thrown: unknown): string | undefined {
  for (const candidate of [thrown, causeOf(thrown), firstOf(causeOf(thrown))]) {
    const code = codeOf(candidate);
    if (code !== undefined) return code;
  }
  return undefined;
}

function causeOf(value: unknown): unknown {
  return value instanceof Error ? value.cause : undefined;
}

function firstOf(value: unknown): unknown {
  return value instanceof AggregateError ? (value.errors[0] as unknown) : undefined;
}

function codeOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("code" in value))
    return undefined;
  const { code } = value;
  return typeof code === "string" && CODE.test(code) ? code : undefined;
}

/** `timeout` once the call was aborted, since an abort is what made it fail; `transport` before. */
function failedAs(
  signal: AbortSignal,
  requestFailure: ModelRequestFailure,
  thrown: unknown,
): Result<never, ModelFailure> {
  if (signal.aborted) return failure("timeout");
  const causeCode = causeCodeOf(thrown);
  return failure("transport", {
    requestFailure,
    ...(causeCode === undefined ? {} : { causeCode }),
  });
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
  let asked: Request;
  try {
    asked = new Request(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: bodyOf(options.modelId, request),
      signal,
    });
  } catch {
    // Kept apart from `network`: a key holding a character no header may carry
    // throws here, and only the category reaches the log, never the key.
    return failure("transport", { requestFailure: "request-construction" });
  }
  let response: Response;
  try {
    response = await options.fetch(asked);
  } catch (error) {
    return failedAs(signal, "network", error);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return failure(refusalOf(response.status), { httpStatus: response.status });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return failedAs(signal, "response-body", error);
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
 * any other refusal `transport`; a refusal carries its `httpStatus`, and a call
 * with no readable answer its `requestFailure` and, when the runtime gave one,
 * its `causeCode`. An answer whose content is not JSON, or that
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
