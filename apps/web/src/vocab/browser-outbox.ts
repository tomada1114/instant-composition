import { learnerStorageRevision } from "../lib/learner-storage";
import { createPagedOutbox, type PagedOutbox } from "./paged-outbox";
import { recordPagedVocabAnswers } from "../lib/vocab-paged-endpoints";
import { pagedAnswerOf } from "./paged-answer";

export const VOCAB_OUTBOX_PREFIX = "vocab-outbox:";
/** Local storage is shared across documents; writes fail closed when the Web Locks API is absent. */
export function browserVocabOutbox(
  sessionId: string,
  generation?: number,
): PagedOutbox {
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    /* Access refusal leaves durable bytes untouched. */
  }
  const revision = learnerStorageRevision();
  return createPagedOutbox({
    valid: () => learnerStorageRevision() === revision,
    key: `${VOCAB_OUTBOX_PREFIX}${sessionId}`,
    storage,
    locks: navigator.locks,
    send: (answers) => {
      const owner = generation ?? answers[0]?.vocabGeneration;
      return owner === undefined
        ? Promise.resolve("failed" as const)
        : recordPagedVocabAnswers(sessionId, owner, answers.map(pagedAnswerOf));
    },
  });
}

/** Earlier paged outboxes are drained one metadata key at a time, with no growing in-memory key list. */
export async function flushEarlierVocabOutboxes(current: string): Promise<boolean> {
  try {
    const storage = window.localStorage;
    for (let index = 0; index < storage.length;) {
      const key = storage.key(index);
      if (
        key === null ||
        !key.startsWith(VOCAB_OUTBOX_PREFIX) ||
        key.includes(":page:") ||
        key.includes(":removed:") ||
        key.endsWith(":recent") ||
        key === `${VOCAB_OUTBOX_PREFIX}${current}`
      ) {
        index += 1;
        continue;
      }
      const queue = browserVocabOutbox(key.slice(VOCAB_OUTBOX_PREFIX.length));
      if (!(await queue.flush())) return false;
      index = queue.count() === 0 ? index + 1 : 0;
    }
    return true;
  } catch {
    return false;
  }
}
