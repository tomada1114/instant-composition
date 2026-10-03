import { errorCode, send, type OperationData, type SendOutcome } from "./api-call";

/** A delta-seconds or HTTP-date hint; unknown formats supply no deadline. */
function retryAt(value: string | null): number | undefined {
  if (value === null) return undefined;
  const text = value.trim();
  const now = Date.now();
  if (/^\d+$/u.test(text)) {
    return Math.min(Number.MAX_SAFE_INTEGER, now + Number(text) * 1000);
  }
  const date = text.endsWith(" GMT") ? Date.parse(text) : Number.NaN;
  return Number.isFinite(date) ? Math.max(now, date) : undefined;
}

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
