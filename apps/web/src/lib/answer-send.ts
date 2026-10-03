import { retryAt } from "./retry-after";
import { errorCode, send, type OperationData, type SendOutcome } from "./api-call";

/**
 * Only the contract's 204 acknowledges answers. Only an explicit status/code
 * refusal for this operation is final; unknown and temporary responses stay queued.
 * A failed attempt stops the drain, and Retry-After can postpone its next attempt.
 */
export async function sendAnswerBatch(
  data: OperationData,
  refusals: Readonly<Record<string, number>>,
): Promise<SendOutcome> {
  try {
    const response = await send("POST", data);
    if (response.status === 204) return "sent";
    const code = errorCode(await response.json().catch(() => null));
    if (code !== undefined && refusals[code] === response.status) return "rejected";
    const deadline = retryAt(response.headers.get("Retry-After"));
    return deadline === undefined ? "failed" : { status: "failed", retryAt: deadline };
  } catch {
    return "failed";
  }
}
