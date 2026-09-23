import type * as z from "zod";

import type { Result } from "../../core/result";
import { failure, readJsonBody } from "../http";
import type { ServiceError, ServiceErrorCode, Services } from "../services";

export interface HandlerDependencies {
  /** Resolved per request, so importing a handler never opens the database. */
  readonly services: () => Services;
}

const STATUS_BY_CODE = {
  ERR_BAD_REQUEST: 400,
  ERR_ROUND_NOT_FOUND: 404,
  ERR_ROUND_CLOSED: 409,
  ERR_NOT_ENOUGH_CARDS: 409,
  ERR_CONTENT_UNREADABLE: 503,
} as const satisfies Record<ServiceErrorCode, number>;

const MESSAGE_BY_CODE = {
  ERR_BAD_REQUEST: "The request does not fit the round or the settings it names.",
  ERR_ROUND_NOT_FOUND: "No round has that id.",
  ERR_ROUND_CLOSED: "That round or day can no longer take this request.",
  ERR_NOT_ENOUGH_CARDS: "Too few reviewed cards can be dealt for a round.",
  ERR_CONTENT_UNREADABLE: "The card content could not be read.",
} as const satisfies Record<ServiceErrorCode, string>;

export function serviceFailure(error: ServiceError): Response {
  return failure(STATUS_BY_CODE[error.code], error.code, MESSAGE_BY_CODE[error.code]);
}

/** Reads and validates a JSON body, or answers the 400/413 to send instead. */
export async function readBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  shape: string,
): Promise<Result<T, Response>> {
  const body = await readJsonBody(request);
  if (!body.ok) {
    return body;
  }
  const parsed = schema.safeParse(body.value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        error: failure(400, "ERR_BAD_REQUEST", `The request body must be ${shape}.`),
      };
}

/** A service result as a response: 200 with the value as JSON, or the error's status. */
export function respond<T>(result: Result<T, ServiceError>): Response {
  return result.ok ? Response.json(result.value) : serviceFailure(result.error);
}
