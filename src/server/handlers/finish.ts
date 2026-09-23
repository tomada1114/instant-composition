import { finishRoundSchema } from "../../core/api";
import { readBody, respond, type HandlerDependencies } from "./respond";

/** `POST /api/rounds/finish`: takes in every answer, closes the round, answers its summary. */
export function createFinishHandler(
  dependencies: HandlerDependencies,
): (request: Request) => Promise<Response> {
  return async function handleFinish(request: Request): Promise<Response> {
    const body = await readBody(
      request,
      finishRoundSchema,
      "an object with a `roundId` and an `answers` array",
    );
    if (!body.ok) {
      return body.error;
    }
    return respond(
      dependencies.services().finishRound(body.value.roundId, body.value.answers),
    );
  };
}
