import type { ApiError } from "../lib/api-call";
import type { Result } from "../lib/result";
import type { AnswerQueue } from "./answer-queue";
import type { AnswerInput } from "./drill-state";

/** A finish waits for sends already in flight, then reads their answers and deadline. */
export async function queuedFinish<T>(
  queue: AnswerQueue,
  finish: (
    pending: readonly AnswerInput[],
    notBefore: number,
  ) => Promise<Result<T, ApiError>>,
): Promise<Result<T, ApiError>> {
  await queue.settled();
  const result = await finish(queue.pending(), queue.retryAt());
  if (!result.ok && result.error.retryAt !== undefined)
    queue.deferUntil(result.error.retryAt);
  return result;
}
