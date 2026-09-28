import { ROUTES, type Route } from "@instant-composition/contracts";
import { Hono } from "hono";

import { answer, type ApiDependencies } from "./answer";
import type { LogLine, RequestOutcome } from "./log";
import { OPERATIONS, type Operation } from "./operations";
import { bindRoutes, routerPath } from "./routes";

/** The path every contract route is served under: a client calls `/api` + its path. */
export const API_ROOT = "/api";

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
  reason: LogLine["reason"];
}

export type ApiApp = Hono<{ Variables: ApiVariables }>;

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
    c.set("reason", null);
    await next();
    deps.log({
      requestId: c.var.requestId,
      operation: c.var.operation,
      outcome: c.var.outcome,
      status: c.res.status,
      durationMs: deps.now() - started,
      learnerId: c.var.learnerId,
      fault: c.var.fault,
      reason: c.var.reason,
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
        c.set("reason", answered.reason);
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
