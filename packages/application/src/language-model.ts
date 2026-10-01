import type { Result } from "@instant-composition/domain";

/** A value JSON can carry, as a JSON Schema literal is written. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * A JSON Schema whose root is an object: the shape a task's output takes, sent
 * to the provider as its structured-output format.
 *
 * @remarks
 * Kept inside what every provider's structured output accepts — no
 * `minLength`, `maxLength`, `minimum` or `maximum`, `additionalProperties:
 * false`, every property required. Length rules are the prompt's and the
 * domain's.
 */
export interface JsonSchemaObject {
  readonly type: "object";
  readonly [keyword: string]: JsonValue;
}

/**
 * The part of a Web-standard `AbortSignal` a model call reads.
 *
 * @remarks
 * This package compiles against the language alone, with no DOM and no Node
 * types, so it names the members it needs instead of the global; any
 * `AbortSignal` satisfies it.
 */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(
    type: "abort",
    listener: () => void,
    options?: { readonly once?: boolean },
  ): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

/** One message of the conversation sent after the system prompt. */
export interface ModelMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

/** One call to a model: a task's prompt, its output schema and its sampling. */
export interface ModelRequest<T> {
  /** The task the call serves; the talk commands narrow it to their own. */
  readonly task: string;
  /** The task's prompt version, such as `talk-teacher@1`, bumped with any prompt or schema change. */
  readonly promptVersion: string;
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly output: {
    /** The schema's name as the provider's structured-output format carries it. */
    readonly name: string;
    readonly schema: JsonSchemaObject;
    /** Narrows the parsed output; `undefined` refuses it as `malformed`. */
    readonly read: (value: unknown) => T | undefined;
  };
  readonly temperature: number;
  readonly maxOutputTokens: number;
}

/** What one call cost and who served it, for the caller's log line. */
export interface ModelCall {
  readonly provider: string;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  /** In US dollars, or `null` when the provider reported no cost. */
  readonly costUsd: number | null;
}

/** A model's answer, narrowed by the request's `read`, and the call that produced it. */
export interface ModelReply<T> {
  readonly value: T;
  readonly call: ModelCall;
}

/**
 * A model call that produced no usable answer.
 *
 * @remarks
 * `reason` tells a caller what retrying could change: `timeout` (the signal
 * aborted) and `throttled` (the provider refused the rate) may pass on a later
 * try; `transport` (unreachable, or any other refusal) may too; `denied` (the
 * key was refused) will not until configuration changes; `malformed` (the
 * answer was not the schema's shape) is the model's. It carries nothing else —
 * never a prompt, a learner's text or the model's output.
 */
export interface ModelFailure {
  readonly code: "ERR_MODEL_UNAVAILABLE";
  readonly reason: "timeout" | "throttled" | "denied" | "malformed" | "transport";
}

/** Every model call goes through this port, one adapter per provider. */
export interface LanguageModel {
  generate<T>(
    request: ModelRequest<T>,
    signal: AbortSignalLike,
  ): Promise<Result<ModelReply<T>, ModelFailure>>;
}
