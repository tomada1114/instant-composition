import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type SearchSchemaInput,
} from "@tanstack/react-router";
import type { ReactElement } from "react";

import { DrillPage } from "./drill/drill-page";
import { roundKindFrom } from "./drill/rounds";
import { HomePage } from "./home/home-page";
import { WelcomePage } from "./home/welcome-page";
import {
  RECORDS_TABS,
  SETTINGS_TABS,
  tabSearch,
  type RecordsTab,
  type SettingsTab,
} from "./lib/screen-tabs";
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
  // A missing or unknown `?tab=` is the first tab, and a link may leave it out.
  validateSearch: (
    search: { tab?: RecordsTab } & SearchSchemaInput,
  ): { tab?: RecordsTab | undefined } => tabSearch(RECORDS_TABS, search.tab),
  component: function RecordsRoute(): ReactElement {
    const { tab = RECORDS_TABS[0] } = recordsRoute.useSearch();
    return <RecordsPage tab={tab} />;
  },
});

const recapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "recap",
  component: RecapPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings",
  validateSearch: (
    search: { tab?: SettingsTab } & SearchSchemaInput,
  ): { tab?: SettingsTab | undefined } => tabSearch(SETTINGS_TABS, search.tab),
  component: function SettingsRoute(): ReactElement {
    const { tab = SETTINGS_TABS[0] } = settingsRoute.useSearch();
    return <SettingsPage tab={tab} />;
  },
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
