import type { VocabPagedAnswer } from "../openapi";
import type { AnswerInput } from "../study/study-state";

export function pagedAnswerOf(answer: AnswerInput): VocabPagedAnswer {
  return {
    id: answer.id,
    cardId: answer.cardId,
    pass: answer.pass,
    grade: answer.grade,
    elapsedMs: answer.elapsedMs,
    page: answer.vocabPage ?? 0,
    ...(answer.answeredAt === undefined ? {} : { answeredAt: answer.answeredAt }),
  };
}
