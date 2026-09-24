import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import type { ReactElement } from "react";

import { DrillPage } from "./drill/drill-page";
import { roundKindFrom } from "./drill/rounds";
import { HomePage } from "./home/home-page";
import { NotFound } from "./not-found";
import type { RoundKind } from "./openapi";

/**
 * The route tree, written as code rather than generated from files (ADR-0008):
 * each route names its parent and its screen, and nothing runs at build time
 * to produce it.
 */
const rootRoute = createRootRoute({
  component: (): ReactElement => <Outlet />,
  notFoundComponent: NotFound,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const drillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "drill",
  // An unknown or missing `?kind=` is today's portion, as it always was.
  validateSearch: (search: Record<string, unknown>): { kind: RoundKind } => ({
    kind: roundKindFrom(search["kind"]),
  }),
  component: function DrillRoute(): ReactElement {
    const { kind } = drillRoute.useSearch();
    return <DrillPage kind={kind} />;
  },
});

/**
 * Screens the home and drill screens link to whose port is #43. The routes
 * exist so those links are typed and land somewhere; until then each renders
 * the not-found page.
 */
function pendingRoute<TPath extends string>(path: TPath) {
  return createRoute({ getParentRoute: () => rootRoute, path, component: NotFound });
}

const routeTree = rootRoute.addChildren([
  homeRoute,
  drillRoute,
  pendingRoute("records"),
  pendingRoute("recap"),
  pendingRoute("settings"),
  pendingRoute("welcome"),
]);

const buildRouter = () => createRouter({ routeTree });

export type AppRouter = ReturnType<typeof buildRouter>;

/** A router over the route tree, on the browser's own history. */
export function createAppRouter(): AppRouter {
  return buildRouter();
}

declare module "@tanstack/react-router" {
  // Teaches `Link`, `useNavigate` and `Navigate` this tree: a path it does not
  // hold, or a `/drill` without its `kind`, fails to compile.
  interface Register {
    router: AppRouter;
  }
}
