import { answerInputSchema } from "../../core/api";
import { readBody, serviceFailure, type HandlerDependencies } from "./respond";

/** `POST /api/answers`: stores one answer; a repeated id is accepted and ignored. */
export function createAnswersHandler(
  dependencies: HandlerDependencies,
): (request: Request) => Promise<Response> {
  return async function handleAnswers(request: Request): Promise<Response> {
    const body = await readBody(
      request,
      answerInputSchema,
      "one answer: id, roundId, cardId, pass, result and elapsedMs (0 to 600000)",
    );
    if (!body.ok) {
      return body.error;
    }
    const stored = dependencies.services().recordAnswer(body.value);
    return stored.ok
      ? new Response(null, { status: 204 })
      : serviceFailure(stored.error);
  };
}
