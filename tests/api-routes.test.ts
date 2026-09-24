import { describe, expect, it } from "vitest";

import {
  createApp,
  OPERATIONS,
  RouteTableError,
  type Operation,
} from "@instant-composition/api";
import {
  answersRequestSchema,
  ROUTES,
  settingsPatchSchema,
  type Route,
} from "@instant-composition/contracts";

import { makeApi } from "./api-harness";
import { fixedCatalog } from "./application-harness";

// The routes the app serves are the contract's ROUTES table, both ways: every
// contract operation answers, and no handler exists without one.

function buildWith(
  routes: readonly Route[],
  operations: Readonly<Record<string, Operation>>,
) {
  return () =>
    createApp(
      {
        stores: { forLearner: () => ({}) as never },
        catalog: fixedCatalog(),
        authenticator: { authenticate: () => Promise.reject(new Error("unused")) },
        now: () => 0,
        requestId: () => "req",
        log: () => undefined,
      },
      routes,
      operations,
    );
}

function problemsOf(build: () => unknown): readonly string[] {
  try {
    build();
  } catch (error) {
    if (error instanceof RouteTableError) {
      expect(error.code).toBe("ERR_API_ROUTE_TABLE");
      return error.problems;
    }
    throw error;
  }
  return [];
}

const route = (overrides: Partial<Route>): Route => ({
  method: "get",
  path: "/v1/probe",
  operationId: "probe",
  summary: "",
  requestBody: null,
  success: { status: 200, body: null },
  errors: [],
  ...overrides,
});

const handler = (overrides: Partial<Operation> = {}): Operation => ({
  body: null,
  roundPath: false,
  handle: () => Promise.resolve({ ok: true, value: {} }),
  ...overrides,
});

describe("the route table", () => {
  it("serves exactly the contract's operations", () => {
    expect(Object.keys(OPERATIONS).sort()).toStrictEqual(
      ROUTES.map((entry) => entry.operationId).sort(),
    );
    expect(problemsOf(buildWith(ROUTES, OPERATIONS))).toStrictEqual([]);
  });

  it.each(ROUTES.map((entry) => [entry.operationId, entry] as const))(
    "answers %s under /api at the contract's method and path",
    async (operationId, entry) => {
      const api = makeApi();
      const path = entry.path.replace("{roundId}", "r-missing");
      await api.call(
        entry.method.toUpperCase(),
        path,
        entry.requestBody === null ? undefined : {},
      );
      expect(api.lines.map((line) => line.operation)).toStrictEqual([operationId]);
    },
  );

  it("refuses to build when a contract operation has no handler", () => {
    expect(problemsOf(buildWith([route({})], {}))).toStrictEqual([
      "probe: the contract route has no handler",
    ]);
  });

  it("refuses to build when a handler has no contract operation", () => {
    expect(problemsOf(buildWith([], { stray: handler() }))).toStrictEqual([
      "stray: the handler has no contract route",
    ]);
  });

  it("refuses a handler validating another schema than the route declares", () => {
    const routes = [route({ method: "patch", requestBody: settingsPatchSchema })];
    expect(
      problemsOf(buildWith(routes, { probe: handler({ body: answersRequestSchema }) })),
    ).toStrictEqual(["probe: the handler validates a body the route does not declare"]);
    expect(problemsOf(buildWith(routes, { probe: handler() }))).toStrictEqual([
      "probe: the handler validates a body the route does not declare",
    ]);
  });

  it("refuses a handler and a path that disagree on {roundId}", () => {
    expect(
      problemsOf(
        buildWith([route({ path: "/v1/rounds/{roundId}" })], { probe: handler() }),
      ),
    ).toStrictEqual(["probe: the handler and the path disagree on {roundId}"]);
    expect(
      problemsOf(buildWith([route({})], { probe: handler({ roundPath: true }) })),
    ).toStrictEqual(["probe: the handler and the path disagree on {roundId}"]);
  });

  it("refuses a path parameter no handler reads", () => {
    expect(
      problemsOf(
        buildWith([route({ path: "/v1/items/{itemId}" })], { probe: handler() }),
      ),
    ).toStrictEqual(["probe: the path names a parameter no handler reads"]);
  });
});
