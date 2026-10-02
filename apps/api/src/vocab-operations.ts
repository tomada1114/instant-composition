import {
  deleteVocabCard,
  finishVocabSession,
  recordVocabAnswers,
  startVocabSession,
  vocabHub,
} from "@instant-composition/application";
import {
  startVocabSessionRequestSchema,
  vocabAnswersRequestSchema,
} from "@instant-composition/contracts";

import { command, query, type Run } from "./handlers";
import type { Operation } from "./operations";

/** An operation on one card the path names, with no body. */
function cardAction(run: Run<[cardId: string]>): Operation {
  return {
    body: null,
    params: ["cardId"],
    handle: ({ deps, context, path }) => run(deps, context, path.cardId),
  };
}

/**
 * The vocabulary activity's operations, keyed by `operationId`; a session's
 * or a card's id comes from the path, and the learner from the request
 * context alone.
 */
export const VOCAB_OPERATIONS: Readonly<Record<string, Operation>> = {
  getVocab: query(vocabHub),
  startVocabSession: command(
    startVocabSessionRequestSchema,
    [],
    (deps, context, _, start) => startVocabSession(deps, context, start),
  ),
  recordVocabAnswers: command(
    vocabAnswersRequestSchema,
    ["sessionId"],
    (deps, context, { sessionId }, batch) =>
      recordVocabAnswers(deps, context, { sessionId, answers: batch.answers }),
  ),
  finishVocabSession: command(
    vocabAnswersRequestSchema,
    ["sessionId"],
    (deps, context, { sessionId }, batch) =>
      finishVocabSession(deps, context, { sessionId, answers: batch.answers }),
  ),
  deleteVocabCard: cardAction((deps, context, cardId) =>
    deleteVocabCard(deps, context, { cardId }),
  ),
};
