import type { HandlerDependencies } from "./respond";

/** `GET /api/history`: the learner's history in the shape `pnpm cards:gaps --history` reads. */
export function createHistoryHandler(
  dependencies: HandlerDependencies,
): (request: Request) => Promise<Response> {
  return function handleHistory(): Promise<Response> {
    return Promise.resolve(Response.json(dependencies.services().history()));
  };
}
