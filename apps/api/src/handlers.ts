import type {
  ApplicationDeps,
  ApplicationError,
  RequestContext,
} from "@instant-composition/application";
import { err, type Result } from "@instant-composition/domain";

import type { BodySchema, Operation, PathParam, PathValues } from "./operations";

// The builders an operation table is written with, kept apart from the
// tables themselves so each table imports them without a cycle.

export type Run<A extends unknown[]> = (
  deps: ApplicationDeps,
  context: RequestContext,
  ...args: A
) => Promise<Result<unknown, ApplicationError>>;

export function query(run: Run<[]>): Operation {
  return {
    body: null,
    params: [],
    handle: ({ deps, context }) => run(deps, context),
  };
}

export function roundQuery(run: Run<[roundId: string]>): Operation {
  return {
    body: null,
    params: ["roundId"],
    handle: ({ deps, context, path }) => run(deps, context, path.roundId),
  };
}

export function command<T>(
  schema: BodySchema<T>,
  params: readonly PathParam[],
  run: Run<[path: PathValues, body: T]>,
): Operation {
  return {
    body: schema,
    params,
    async handle({ deps, context, path, body }) {
      const parsed = schema.safeParse(body);
      return parsed.success
        ? run(deps, context, path, parsed.data)
        : err({ code: "ERR_BAD_REQUEST" });
    },
  };
}
