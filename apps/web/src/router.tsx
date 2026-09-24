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
import { WelcomePage } from "./home/welcome-page";
import { NotFound } from "./not-found";
import type { RoundKind } from "./openapi";
import { RecordsPage } from "./records/records-page";
import { SettingsPage } from "./settings/settings-page";
import { RecapPage } from "./summary/recap-page";

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

const recordsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "records",
  component: RecordsPage,
});

const recapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "recap",
  component: RecapPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings",
  component: SettingsPage,
});

const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "welcome",
  component: WelcomePage,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  drillRoute,
  recordsRoute,
  recapRoute,
  settingsRoute,
  welcomeRoute,
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
