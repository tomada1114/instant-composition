import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
} from "@tanstack/react-router";
import { useEffect, type ReactElement } from "react";

import { roundKindFrom } from "./drill/rounds";
import { HomePage } from "./home/home-page";
import { WelcomePage } from "./home/welcome-page";
import { FocusLayout, ShellLayout } from "./lib/frame";
import { NotFound } from "./not-found";
import type { RoundKind } from "./openapi";
import { vocabSearch } from "./vocab/sessions";

import { PageLoading, PageLoadFailed } from "./lib/page-shell";

const DrillPage = lazyRouteComponent(() => import("./drill/drill-page"), "DrillPage");
const RecordsPage = lazyRouteComponent(
  () => import("./records/records-page"),
  "RecordsPage",
);
const SettingsPage = lazyRouteComponent(
  () => import("./settings/settings-page"),
  "SettingsPage",
);
const RecapPage = lazyRouteComponent(() => import("./summary/recap-page"), "RecapPage");
const VocabPage = lazyRouteComponent(() => import("./vocab/vocab-page"), "VocabPage");
const VocabStudyPage = lazyRouteComponent(
  () => import("./vocab/vocab-study-page"),
  "VocabStudyPage",
);
const TalkPage = lazyRouteComponent(() => import("./talk/talk-page"), "TalkPage");

/** Reload the document to recover a failed module URL; tab-stored answer queues survive. */
function RouteLoadFailed(): ReactElement {
  useEffect(() => {
    document.getElementById("main")?.focus();
  }, []);
  return (
    <PageLoadFailed
      withNav
      onReload={() => {
        window.location.reload();
      }}
    />
  );
}

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
  component: Object.assign(
    function DrillRoute(): ReactElement {
      const { kind } = drillRoute.useSearch();
      return <DrillPage kind={kind} />;
    },
    { preload: () => DrillPage.preload?.() ?? Promise.resolve() },
  ),
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

const vocabRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "vocab",
  component: VocabPage,
});
const vocabStudyRoute = createRoute({
  getParentRoute: () => focusRoute,
  path: "vocab/study",
  validateSearch: vocabSearch,
  component: Object.assign(
    function VocabStudyRoute(): ReactElement {
      return <VocabStudyPage search={vocabStudyRoute.useSearch()} />;
    },
    { preload: () => VocabStudyPage.preload?.() ?? Promise.resolve() },
  ),
});

const routeTree = rootRoute.addChildren([
  shellRoute.addChildren([
    homeRoute,
    vocabRoute,
    recordsRoute,
    settingsRoute,
    talkRoute,
  ]),
  focusRoute.addChildren([drillRoute, recapRoute, vocabStudyRoute]),
  welcomeRoute,
]);

const buildRouter = () =>
  createRouter({
    routeTree,
    defaultPreload: "intent",
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
    defaultPendingComponent: (): ReactElement => <PageLoading withNav />,
    defaultErrorComponent: RouteLoadFailed,
  });

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
