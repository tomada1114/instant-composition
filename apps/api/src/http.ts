import {
  MESSAGE_BY_CODE,
  STATUS_BY_CODE,
  type ErrorCode,
} from "@instant-composition/contracts";
import { err, ok, type Result } from "@instant-composition/domain";

/**
 * The most bytes a request body may carry before it is refused part-read.
 *
 * @remarks
 * The largest body a contract operation accepts is a batch of
 * `MAX_ROUND_ANSWERS` answers, a few kilobytes of JSON even with every id at
 * its 64-character bound; 64 KiB leaves wide headroom above that while
 * keeping what concurrent requests can make the process buffer small.
 */
export const MAX_REQUEST_BODY_BYTES = 65_536;

/**
 * The failure body every non-2xx contract answer carries: the code, the status
 * the contract gives it, and the code's one fixed sentence. The message never
 * quotes what the request carried.
 */
export function failure(code: ErrorCode): Response {
  return Response.json(
    { error: { code, message: MESSAGE_BY_CODE[code] } },
    { status: STATUS_BY_CODE[code] },
  );
}

type BodyRefusal = "ERR_PAYLOAD_TOO_LARGE" | "ERR_BAD_REQUEST";

/**
 * `request`'s body parsed as JSON, or the code to refuse it with.
 *
 * @remarks
 * The body is read chunk by chunk and abandoned the moment it crosses
 * {@link MAX_REQUEST_BODY_BYTES}, rather than trusting `Content-Length`, which
 * is absent under chunked transfer encoding and otherwise whatever the client
 * says. A stream that fails part-way — a client that hung up — is a
 * `ERR_BAD_REQUEST` like a body that is not JSON, never an exception escaping
 * the handler.
 */
export async function readJsonBody(
  request: Request,
): Promise<Result<unknown, BodyRefusal>> {
  const text = await readBodyWithin(request, MAX_REQUEST_BODY_BYTES);
  if (!text.ok) {
    return text;
  }
  try {
    return ok(JSON.parse(text.value) as unknown);
  } catch {
    return err("ERR_BAD_REQUEST");
  }
}

async function readBodyWithin(
  request: Request,
  maxBytes: number,
): Promise<Result<string, BodyRefusal>> {
  if (request.body === null) {
    return ok("");
  }
  const reader: ReadableStreamDefaultReader<Uint8Array> = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        return ok(text + decoder.decode());
      }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        return err("ERR_PAYLOAD_TOO_LARGE");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch {
    return err("ERR_BAD_REQUEST");
  } finally {
    // Tell the sender to stop rather than draining the rest. Cancelling a
    // stream that already errored rejects with that error, which must not turn
    // a decided refusal into an exception here.
    await reader.cancel().catch(() => undefined);
  }
}
