import { requestContext, type ApplicationDeps } from "@instant-composition/application";
import { roundIdParamSchema, ROUTES, type Route } from "@instant-composition/contracts";
import { Hono } from "hono";

import type { Authenticator } from "./authenticator";
import { failure, readJsonBody } from "./http";
import type { LogSink, RequestOutcome } from "./log";
import { OPERATIONS, type Operation } from "./operations";
import { bindRoutes, routerPath } from "./routes";

/** The path every contract route is served under: a client calls `/api` + its path. */
export const API_ROOT = "/api";

/** Everything the app is handed, so a test runs it with no network and a fixed clock. */
export interface ApiDependencies extends ApplicationDeps {
  readonly authenticator: Authenticator;
  /** Epoch milliseconds: the request's `now`, and both ends of its duration. */
  readonly now: () => number;
  readonly requestId: () => string;
  readonly log: LogSink;
}

/** The contract's routes and the handlers served disagree, so the app refuses to be built. */
export class RouteTableError extends Error {
  readonly code = "ERR_API_ROUTE_TABLE" as const;
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`The API's handlers do not match the contract: ${problems.join("; ")}.`);
    this.name = "RouteTableError";
    this.problems = problems;
  }
}

/** What one request's log line is gathered in while it is answered. */
export interface ApiVariables {
  requestId: string;
  operation: string | null;
  outcome: RequestOutcome;
  learnerId: string | null;
  fault: string | null;
}

export type ApiApp = Hono<{ Variables: ApiVariables }>;

interface Answered {
  readonly response: Response;
  readonly outcome: RequestOutcome;
  readonly learnerId: string | null;
}

function refused(
  code: Parameters<typeof failure>[0],
  learnerId: string | null,
): Answered {
  return { response: failure(code), outcome: code, learnerId };
}

/** Authenticate, check the path and the body, run the operation, answer. */
async function answer(
  route: Route,
  operation: Operation,
  deps: ApiDependencies,
  request: Request,
  params: Readonly<Record<string, string>>,
  requestId: string,
): Promise<Answered> {
  const identity = await deps.authenticator.authenticate(request);
  const learnerId = identity.learner.id;
  const context = requestContext({ ...identity, now: deps.now(), requestId });
  if (!context.ok) {
    return refused(context.error.code, learnerId);
  }
  let roundId = "";
  if (operation.roundPath) {
    const parsed = roundIdParamSchema.safeParse(params["roundId"]);
    if (!parsed.success) {
      return refused("ERR_BAD_REQUEST", learnerId);
    }
    roundId = parsed.data;
  }
  let body: unknown = undefined;
  if (operation.body !== null) {
    const read = await readJsonBody(request);
    if (!read.ok) {
      return refused(read.error, learnerId);
    }
    body = read.value;
  }
  const outcome = await operation.handle({
    deps,
    context: context.value,
    roundId,
    body,
  });
  if (!outcome.ok) {
    return refused(outcome.error.code, learnerId);
  }
  const response =
    route.success.status === 204
      ? new Response(null, { status: 204 })
      : Response.json(outcome.value, { status: route.success.status });
  return { response, outcome: "ok", learnerId };
}

/**
 * The API as a Web-standard app: `app.fetch(request)` answers every contract
 * route in `packages/contracts`' `ROUTES` under {@link API_ROOT}, and writes
 * one log line per request, matched or not.
 *
 * @throws {@link RouteTableError} when a contract route has no handler or a
 * handler has no contract route, so a gap is found when the app is built
 * rather than by the first client that calls it.
 */
export function createApp(
  deps: ApiDependencies,
  routes: readonly Route[] = ROUTES,
  operations: Readonly<Record<string, Operation>> = OPERATIONS,
): ApiApp {
  const table = bindRoutes(routes, operations);
  if (table.problems.length > 0) {
    throw new RouteTableError(table.problems);
  }
  const app: ApiApp = new Hono<{ Variables: ApiVariables }>();

  app.use(async (c, next) => {
    const started = deps.now();
    c.set("requestId", deps.requestId());
    c.set("operation", null);
    c.set("outcome", "unmatched");
    c.set("learnerId", null);
    c.set("fault", null);
    await next();
    deps.log({
      requestId: c.var.requestId,
      operation: c.var.operation,
      outcome: c.var.outcome,
      status: c.res.status,
      durationMs: deps.now() - started,
      learnerId: c.var.learnerId,
      fault: c.var.fault,
    });
  });

  for (const { route, operation } of table.bound) {
    app.on(
      route.method.toUpperCase(),
      `${API_ROOT}${routerPath(route.path)}`,
      async (c) => {
        c.set("operation", route.operationId);
        const answered = await answer(
          route,
          operation,
          deps,
          c.req.raw,
          c.req.param(),
          c.var.requestId,
        );
        c.set("outcome", answered.outcome);
        c.set("learnerId", answered.learnerId);
        return answered.response;
      },
    );
  }

  app.notFound(() => new Response(null, { status: 404 }));
  app.onError((error, c) => {
    c.set("outcome", "failed");
    c.set("fault", error.name);
    return new Response(null, { status: 500 });
  });
  return app;
}
