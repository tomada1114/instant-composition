import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { PageLoadFailed } from "../lib/page-shell";
import { HOME_QUERY, isSignedOut } from "../lib/queries";
import { HomeScreen } from "./home-screen";
import { HomeSkeleton } from "./home-skeleton";
import { LandingScreen } from "./landing-screen";

/**
 * The `/` route: the home view as the API has it now. A cached view is never
 * acted on — it may say "placement" about a placement just finished — so the
 * skeleton stands until a read made for this visit answers. A first visit
 * goes on to picking topics, and a visit before the placement round is done
 * goes on to that round. A signed-out visitor sees the landing screen, and
 * every other route sends one here.
 */
export function HomePage(): ReactElement {
  const home = useQuery({ ...HOME_QUERY, refetchOnMount: "always" });
  const reload = (): void => {
    void home.refetch();
  };

  if (!home.isFetchedAfterMount) return <HomeSkeleton />;
  if (isSignedOut(home.error)) return <LandingScreen />;
  if (home.isError || home.data === undefined) {
    return <PageLoadFailed onReload={reload} withTabBar />;
  }
  const view = home.data;
  if (view.state.kind === "onboarding") return <Navigate to="/welcome" replace />;
  if (view.state.kind === "placement") {
    return <Navigate to="/drill" search={{ kind: "placement" }} replace />;
  }
  return <HomeScreen view={view} onReload={reload} />;
}
