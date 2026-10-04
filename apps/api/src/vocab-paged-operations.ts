import {
  startPagedVocabSession,
  preparePagedVocabSession,
  getPagedVocabPage,
  recordPagedVocabAnswers,
  finishPagedVocabSession,
} from "@instant-composition/application";
import {
  startVocabSessionRequestSchema,
  vocabPageRequestSchema,
  vocabPagedAnswersRequestSchema,
} from "@instant-composition/contracts";
import { command } from "./handlers";
import type { Operation } from "./operations";

/** Additional paths keep legacy queued payloads and end-of-deck semantics intact. */
export const VOCAB_PAGED_OPERATIONS: Readonly<Record<string, Operation>> = {
  startPagedVocabSession: command(
    startVocabSessionRequestSchema,
    [],
    (deps, context, _, body) => startPagedVocabSession(deps, context, body),
  ),
  preparePagedVocabSession: {
    body: null,
    params: ["sessionId"],
    handle: ({ deps, context, path }) =>
      preparePagedVocabSession(deps, context, path.sessionId),
  },
  getPagedVocabPage: command(
    vocabPageRequestSchema,
    ["sessionId"],
    (deps, context, { sessionId }, body) =>
      getPagedVocabPage(deps, context, {
        sessionId,
        cursor: body.cursor,
        ...(body.retained === undefined ? {} : { retained: body.retained }),
      }),
  ),
  recordPagedVocabAnswers: command(
    vocabPagedAnswersRequestSchema,
    ["sessionId"],
    (deps, context, { sessionId }, body) =>
      recordPagedVocabAnswers(deps, context, { sessionId, ...body }),
  ),
  finishPagedVocabSession: command(
    vocabPagedAnswersRequestSchema,
    ["sessionId"],
    (deps, context, { sessionId }, body) =>
      finishPagedVocabSession(deps, context, { sessionId, ...body }),
  ),
};
