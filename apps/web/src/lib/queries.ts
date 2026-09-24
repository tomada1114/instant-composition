import { QueryClient, queryOptions } from "@tanstack/react-query";

import { getHome } from "./endpoints";

/** A query whose call answered an error: the API's code, or `ERR_NETWORK`. */
export class ApiRequestError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`The API answered ${code}.`);
    this.name = "ApiRequestError";
    this.code = code;
  }
}

/**
 * `GET /v1/home`, which both screens read: the home screen for itself, the
 * drill for the sound switch, the daily size and whether this is the
 * placement.
 */
export const HOME_QUERY = queryOptions({
  queryKey: ["home"],
  queryFn: async () => {
    const home = await getHome();
    if (!home.ok) throw new ApiRequestError(home.error.code);
    return home.value;
  },
});

/**
 * One cache per mounted app. A failed read is not retried behind the
 * learner's back: the screen says so and offers a reload, as it did when the
 * server rendered it. A window regaining focus refetches nothing either — a
 * drill must not have its placement flag change under it.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
}
