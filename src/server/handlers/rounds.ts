import { startRoundSchema } from "../../core/api";
import { readBody, respond, type HandlerDependencies } from "./respond";

/** `POST /api/rounds { kind }`: starts a round, or resumes today's open one of that kind. */
export function createRoundsHandler(
  dependencies: HandlerDependencies,
): (request: Request) => Promise<Response> {
  return async function handleRounds(request: Request): Promise<Response> {
    const body = await readBody(
      request,
      startRoundSchema,
      'an object with a `kind` of "placement", "today", "yesterday" or "extra"',
    );
    if (!body.ok) {
      return body.error;
    }
    return respond(dependencies.services().startRound(body.value.kind));
  };
}
