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
import { FocusLayout, ShellLayout } from "./lib/frame";
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
  component: RecordsPage,
});

const recapRoute = createRoute({
  getParentRoute: () => focusRoute,
  path: "recap",
  component: RecapPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "settings",
  component: SettingsPage,
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
