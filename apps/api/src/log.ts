import type {
  CatalogUnreadable,
  ModelFailure,
  ModelRequestFailure,
} from "@instant-composition/application";
import type { ErrorCode } from "@instant-composition/contracts";

/**
 * How a request ended: `ok`, the contract code it was refused with,
 * `unmatched` when no contract operation has its method and path, or `failed`
 * when a handler threw and the answer is a bare 500.
 */
export type RequestOutcome = "ok" | ErrorCode | "unmatched" | "failed";

/**
 * The one line written per request.
 *
 * @remarks
 * Every field is present on every line, `null` where it does not apply, so a
 * log query never has to ask whether a key exists. A line never carries a
 * request body, a path, a card's text, a learner's answers, a token, a cookie,
 * an email or a password: nothing here is copied from what the caller sent.
 */
export interface LogLine {
  /** Made by the server for this request; never taken from a header. */
  readonly requestId: string;
  /**
   * The contract `operationId`, the web-session endpoint's name
   * (`signIn`, `refreshSession`, `signOut`), or `null`
   * when no operation matched.
   */
  readonly operation: string | null;
  readonly outcome: RequestOutcome;
  readonly status: number;
  readonly durationMs: number;
  /** The internal learner id the request acted as, once it was authenticated. */
  readonly learnerId: string | null;
  /** The thrown error's class name when `outcome` is `failed`; never its message. */
  readonly fault: string | null;
  /** Why the catalog could not be read when `outcome` is `ERR_CONTENT_UNREADABLE`; never the file's contents. */
  readonly reason: CatalogUnreadable["reason"] | null;
}

/**
 * How one model call ended: `ok`, the `ModelFailure` reason it produced no
 * answer for, or `failed` when the adapter threw — a key that could not be read.
 */
export type ModelCallOutcome = "ok" | ModelFailure["reason"] | "failed";

/**
 * The line written per model call, beside its request's line, which it joins
 * by `requestId`.
 *
 * @remarks
 * Every field is present on every line. A line never carries a prompt, a
 * learner's text or the model's output: what was asked is named by `task` and
 * `promptVersion` alone. The counts and the cost are `null` when the call
 * produced no answer; `latencyMs` is the provider's measure on an answer and
 * the edge's own otherwise. `httpStatus`, `requestFailure` and `causeCode`
 * name which failure a `transport`, `throttled` or `denied` call was, never
 * what the provider or the runtime said.
 */
export interface ModelCallLine {
  readonly kind: "model-call";
  readonly requestId: string;
  readonly task: string;
  readonly promptVersion: string;
  readonly provider: string;
  readonly modelId: string;
  readonly outcome: ModelCallOutcome;
  readonly attempt: number;
  readonly duplicatePossible: boolean;
  /** Whether this attempt may have reached the provider without a usable result. */
  readonly providerOutcome: "known" | "unknown";
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly latencyMs: number;
  /** In US dollars; `null` when the provider reported none or the call produced no answer. */
  readonly costUsd: number | null;
  /** The status a provider refused the call with; `null` on an answer or with no status. */
  readonly httpStatus: number | null;
  /** Where a call with no readable answer broke off; `null` otherwise. */
  readonly requestFailure: ModelRequestFailure | null;
  /** The runtime's code for that break (`ENOTFOUND`, …); `null` when it gave none. */
  readonly causeCode: string | null;
}

/** Where log lines go: stdout on a local run, a recording array in a test. */
export type LogSink = (line: LogLine | ModelCallLine) => void;

/** A sink writing each line as one line of JSON to `write`. */
export function jsonLines(write: (text: string) => void): LogSink {
  return (line) => {
    write(`${JSON.stringify(line)}\n`);
  };
}
