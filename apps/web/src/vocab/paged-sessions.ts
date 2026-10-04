import { flushEarlierVocabOutboxes } from "./browser-outbox";
import { readVocabCheckpoint } from "./paged-checkpoint";
import {
  startPagedVocabSession,
  preparePagedVocabSession,
  getPagedVocabPage,
} from "../lib/vocab-paged-endpoints";
import { err, type Result } from "../lib/result";
import type { ApiError } from "../lib/api-call";
import type { VocabPage } from "../openapi";
import type { VocabSearch } from "./sessions";
import { flushEarlierRounds, sessionStore } from "../study/answer-queue";
import { sendVocabAnswer, VOCAB_QUEUE_PREFIX } from "./sessions";

/** Each explicit preparation request is bounded, and a reload reuses its persisted request id. */
export async function requestPagedVocabSession(
  search: VocabSearch,
  sessionId: string,
  active: () => boolean = () => true,
): Promise<Result<VocabPage, ApiError>> {
  const empty = await flushEarlierRounds({
    currentId: sessionId,
    prefix: VOCAB_QUEUE_PREFIX,
    send: sendVocabAnswer,
    storage: sessionStore(),
  });
  if (!empty || !(await flushEarlierVocabOutboxes(sessionId)))
    return err({ code: "ERR_NETWORK" });
  let prepared = await startPagedVocabSession({ sessionId, ...search });
  if (!prepared.ok) return prepared;
  while (prepared.value.status === "building") {
    if (!active()) return err({ code: "ERR_NETWORK" });
    prepared = await preparePagedVocabSession(sessionId);
    if (!prepared.ok) return prepared;
  }
  const checkpoint = readVocabCheckpoint(sessionId, prepared.value.generation);
  const retained =
    checkpoint === undefined
      ? undefined
      : [
          ...new Set([
            ...checkpoint.reAsks.map((card) => card.cardId),
            ...(checkpoint.card === undefined ? [] : [checkpoint.card.cardId]),
          ]),
        ].flatMap((cardId) => {
          const card = checkpoint.cards[cardId];
          return card === undefined ? [] : [{ cardId, page: card.page }];
        });
  return active()
    ? getPagedVocabPage(
        sessionId,
        checkpoint === undefined
          ? null
          : `${String(checkpoint.generation)}:${String(checkpoint.loadedPage)}`,
        retained,
      )
    : err({ code: "ERR_NETWORK" });
}
