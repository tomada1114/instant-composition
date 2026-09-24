import { QueryClient, queryOptions } from "@tanstack/react-query";

import {
  getHome,
  getRecords,
  getRoundSummary,
  getSettings,
  type ApiError,
} from "./endpoints";
import type { RoundSummary } from "../openapi";
import type { Result } from "./result";

/** A query whose call answered an error: the API's code, or `ERR_NETWORK`. */
export class ApiRequestError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`The API answered ${code}.`);
    this.name = "ApiRequestError";
    this.code = code;
  }
}

/** A query's value, or the API's error thrown for the query cache to hold. */
async function valueOf<T>(request: Promise<Result<T, ApiError>>): Promise<T> {
  const result = await request;
  if (!result.ok) throw new ApiRequestError(result.error.code);
  return result.value;
}

/** The code a failed query answered, or `ERR_NETWORK` for anything else it threw. */
export function errorCodeOf(error: unknown): string {
  return error instanceof ApiRequestError ? error.code : "ERR_NETWORK";
}

/**
 * `GET /v1/home`, which both screens read: the home screen for itself, the
 * drill for the sound switch, the daily size and whether this is the
 * placement.
 */
export const HOME_QUERY = queryOptions({
  queryKey: ["home"],
  queryFn: () => valueOf(getHome()),
});

/** `GET /v1/settings`: the settings screen's page, and the topics the welcome screen offers. */
export const SETTINGS_QUERY = queryOptions({
  queryKey: ["settings"],
  queryFn: () => valueOf(getSettings()),
});

export const RECORDS_QUERY = queryOptions({
  queryKey: ["records"],
  queryFn: () => valueOf(getRecords()),
});

/** `GET /v1/rounds/{roundId}/summary`: what a finished round kept, final, cached by its id. */
export function readRoundSummary(roundId: string): Promise<RoundSummary> {
  return valueOf(getRoundSummary(roundId));
}

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
