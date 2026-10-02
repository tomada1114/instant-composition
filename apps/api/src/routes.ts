import {
  cardIdParamSchema,
  roundIdParamSchema,
  sessionIdParamSchema,
  talkIdParamSchema,
  turnSchema,
  type Route,
} from "@instant-composition/contracts";

import type { Operation, PathParam, PathValues } from "./operations";

/** Every parameter a contract path may name; an operation reads the ones its path names. */
const PATH_PARAMS: readonly PathParam[] = [
  "roundId",
  "talkId",
  "turn",
  "sessionId",
  "cardId",
];

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
  const known = PATH_PARAMS.map((param) => `{${param}}`);
  return [
    ...(params.every((param) => known.includes(param))
      ? []
      : [`${route.operationId}: the path names a parameter no handler reads`]),
    ...((operation.body as unknown) === route.requestBody
      ? []
      : [
          `${route.operationId}: the handler validates a body the route does not declare`,
        ]),
    ...PATH_PARAMS.filter(
      (param) => operation.params.includes(param) !== params.includes(`{${param}}`),
    ).map(
      (param) =>
        `${route.operationId}: the handler and the path disagree on {${param}}`,
    ),
  ];
}

/**
 * Pairs every contract route with its handler, checked both ways: a contract
 * operation with no handler, and a handler with no contract operation, are
 * each a problem. For a pair that exists, the handler must validate its body
 * with the very schema the route declares, and read each path parameter
 * exactly when the path names it.
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

function idOf(
  schema: typeof roundIdParamSchema,
  raw: string | undefined,
): string | undefined {
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** A `{turn}` written as a plain decimal, then held to the contract's bounds. */
function turnOf(raw: string | undefined): number | undefined {
  const parsed = /^[1-9]\d{0,2}$/.test(raw ?? "")
    ? turnSchema.safeParse(Number(raw))
    : undefined;
  return parsed?.success === true ? parsed.data : undefined;
}

/**
 * The path parameters `params` names, each validated with the contract's
 * schema for it, or `undefined` when one is refused. A parameter the path does
 * not name reads as `""`, or `0` for `turn`.
 */
export function readPath(
  params: readonly PathParam[],
  raw: Readonly<Record<string, string>>,
): PathValues | undefined {
  const roundId = params.includes("roundId")
    ? idOf(roundIdParamSchema, raw["roundId"])
    : "";
  const talkId = params.includes("talkId")
    ? idOf(talkIdParamSchema, raw["talkId"])
    : "";
  const turn = params.includes("turn") ? turnOf(raw["turn"]) : 0;
  const sessionId = params.includes("sessionId")
    ? idOf(sessionIdParamSchema, raw["sessionId"])
    : "";
  const cardId = params.includes("cardId")
    ? idOf(cardIdParamSchema, raw["cardId"])
    : "";
  return roundId === undefined ||
    talkId === undefined ||
    turn === undefined ||
    sessionId === undefined ||
    cardId === undefined
    ? undefined
    : { roundId, talkId, turn, sessionId, cardId };
}
