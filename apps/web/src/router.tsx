import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  useRouterState,
  type SearchSchemaInput,
} from "@tanstack/react-router";
import type { ReactElement } from "react";

import { DrillPage } from "./drill/drill-page";
import { roundKindFrom } from "./drill/rounds";
import { HomePage } from "./home/home-page";
import { WelcomePage } from "./home/welcome-page";
import { FocusLayout, ShellLayout } from "./lib/frame";
import {
  RECORDS_TABS,
  SETTINGS_TABS,
  addressedTab,
  tabSearch,
  type RecordsTab,
  type SettingsTab,
} from "./lib/screen-tabs";
import { NotFound } from "./not-found";
import type { RoundKind } from "./openapi";
import { RecordsPage } from "./records/records-page";
import { SettingsPage } from "./settings/settings-page";
import { RecapPage } from "./summary/recap-page";
import { TalkPage } from "./talk/talk-page";

/**
 * The route tree, written as code rather than generated from files:
 * each route names its parent and its screen, and nothing runs at build time
 * to produce it. Two pathless layout routes hold the screens: the shell (the
 * hub screens, with the navigation) and the focus layout (`/drill` and
 * `/recap`, without it). The welcome and a path with no screen use neither.
 */
const rootRoute = createRootRoute({
  component: (): ReactElement => <Outlet />,
  notFoundComponent: NotFound,
});

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: ShellLayout,
});

const focusRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "focus",
  component: FocusLayout,
});

const homeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  component: HomePage,
});

const drillRoute = createRoute({
  getParentRoute: () => focusRoute,
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
  getParentRoute: () => shellRoute,
  path: "records",
  // A missing `?tab=` is the first tab, and a link may leave it out; an
  // unknown one is replaced by the bare path.
  validateSearch: (
    search: { tab?: RecordsTab } & SearchSchemaInput,
  ): { tab?: RecordsTab | undefined } => tabSearch(RECORDS_TABS, search.tab),
  component: function RecordsRoute(): ReactElement {
    const searchStr = useRouterState({ select: (state) => state.location.searchStr });
    const { tab, stray } = addressedTab(RECORDS_TABS, searchStr);
    if (stray) return <Navigate to="/records" replace />;
    return <RecordsPage tab={tab} />;
  },
});

const recapRoute = createRoute({
  getParentRoute: () => focusRoute,
  path: "recap",
  component: RecapPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "settings",
  validateSearch: (
    search: { tab?: SettingsTab } & SearchSchemaInput,
  ): { tab?: SettingsTab | undefined } => tabSearch(SETTINGS_TABS, search.tab),
  component: function SettingsRoute(): ReactElement {
    const searchStr = useRouterState({ select: (state) => state.location.searchStr });
    const { tab, stray } = addressedTab(SETTINGS_TABS, searchStr);
    if (stray) return <Navigate to="/settings" replace />;
    return <SettingsPage tab={tab} />;
  },
});

const talkRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "talk",
  component: TalkPage,
});

const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "welcome",
  component: WelcomePage,
});

const routeTree = rootRoute.addChildren([
  shellRoute.addChildren([homeRoute, recordsRoute, settingsRoute, talkRoute]),
  focusRoute.addChildren([drillRoute, recapRoute]),
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
