import type { CatalogUnreadable } from "@instant-composition/application";
import type { ErrorCode } from "@instant-composition/contracts";

/**
 * How a request ended: `ok`, the contract code it was refused with,
 * `unmatched` when no contract operation has its method and path, or `failed`
 * when a handler threw and the answer is a bare 500.
 */
export type RequestOutcome = "ok" | ErrorCode | "unmatched" | "failed";

/**
 * The one line written per request (ADR-0009's observability baseline).
 *
 * @remarks
 * Every field is present on every line, `null` where it does not apply, so a
 * log query never has to ask whether a key exists. A line never carries a
 * request body, a path, a card's text or a learner's answers: nothing here is
 * copied from what the caller sent.
 */
export interface LogLine {
  /** Made by the server for this request; never taken from a header. */
  readonly requestId: string;
  /** The contract `operationId`, or `null` when no operation matched. */
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

/** Where log lines go: stdout on a local run, a recording array in a test. */
export type LogSink = (line: LogLine) => void;

/** A sink writing each line as one line of JSON to `write`. */
export function jsonLines(write: (text: string) => void): LogSink {
  return (line) => {
    write(`${JSON.stringify(line)}\n`);
  };
}
