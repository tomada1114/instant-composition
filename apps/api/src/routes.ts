import type { Route } from "@instant-composition/contracts";

import type { Operation } from "./operations";

/** The one path parameter a contract route names today. */
const ROUND_PARAM = "{roundId}";

/** Every `{name}` a contract path names. */
function pathParams(path: string): string[] {
  return [...path.matchAll(/\{[^{}]*\}/g)].map((match) => match[0]);
}

/** A contract route and the handler that serves it. */
export interface BoundRoute {
  readonly route: Route;
  readonly operation: Operation;
}

/** Each route paired with its handler, and every disagreement between the two tables. */
export interface RouteTable {
  readonly bound: readonly BoundRoute[];
  /** One sentence per disagreement; empty when the tables agree. */
  readonly problems: readonly string[];
}

function routeProblems(route: Route, operation: Operation): string[] {
  const params = pathParams(route.path);
  return [
    ...(params.every((param) => param === ROUND_PARAM)
      ? []
      : [`${route.operationId}: the path names a parameter no handler reads`]),
    ...((operation.body as unknown) === route.requestBody
      ? []
      : [
          `${route.operationId}: the handler validates a body the route does not declare`,
        ]),
    ...(operation.roundPath === params.includes(ROUND_PARAM)
      ? []
      : [`${route.operationId}: the handler and the path disagree on {roundId}`]),
  ];
}

/**
 * Pairs every contract route with its handler, checked both ways: a contract
 * operation with no handler, and a handler with no contract operation, are
 * each a problem. For a pair that exists, the handler must validate its body
 * with the very schema the route declares, and read `{roundId}` exactly when
 * the path names it.
 */
export function bindRoutes(
  routes: readonly Route[],
  operations: Readonly<Record<string, Operation>>,
): RouteTable {
  const bound: BoundRoute[] = [];
  const problems: string[] = [];
  for (const route of routes) {
    const operation = operations[route.operationId];
    if (operation === undefined) {
      problems.push(`${route.operationId}: the contract route has no handler`);
    } else {
      bound.push({ route, operation });
      problems.push(...routeProblems(route, operation));
    }
  }
  const contracted = new Set(routes.map((route) => route.operationId));
  for (const id of Object.keys(operations)) {
    if (!contracted.has(id)) {
      problems.push(`${id}: the handler has no contract route`);
    }
  }
  return { bound, problems };
}

/** A contract path in the router's own spelling: `{roundId}` becomes `:roundId`. */
export function routerPath(path: string): string {
  return path.replaceAll(/\{([^}]*)\}/g, ":$1");
}
