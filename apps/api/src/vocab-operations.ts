import {
  finishVocabSession,
  recordVocabAnswers,
  startVocabSession,
  vocabHub,
} from "@instant-composition/application";
import {
  startVocabSessionRequestSchema,
  vocabAnswersRequestSchema,
} from "@instant-composition/contracts";

import { command, query } from "./handlers";
import type { Operation } from "./operations";

/**
 * The vocabulary activity's operations, keyed by `operationId`; a session's
 * id comes from the path, and the learner from the request context alone.
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
};
