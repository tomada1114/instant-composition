import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { PageLoadFailed, PageLoading } from "../lib/page-shell";
import { HOME_QUERY, SETTINGS_QUERY } from "../lib/queries";
import { WelcomeScreen } from "./welcome-screen";

/**
 * The `/welcome` route: the first visit's topic choice, offered from the
 * topics the settings read lists. Once topics are chosen it is the start
 * screen's, so a visit after that goes to `/`.
 */
export function WelcomePage(): ReactElement {
  const home = useQuery({ ...HOME_QUERY, refetchOnMount: "always" });
  const page = useQuery({ ...SETTINGS_QUERY, refetchOnMount: "always" });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const reload = (): void => {
    void home.refetch();
    void page.refetch();
  };

  if (!home.isFetchedAfterMount || !page.isFetchedAfterMount) return <PageLoading />;
  if (
    home.isError ||
    page.isError ||
    home.data === undefined ||
    page.data === undefined
  ) {
    return <PageLoadFailed onReload={reload} />;
  }
  if (home.data.state.kind !== "onboarding") return <Navigate to="/" replace />;
  return (
    <WelcomeScreen
      topics={page.data.topics}
      onReload={reload}
      onSaved={() => {
        // The cached home view still says "onboarding"; the drill must read
        // the placement it now is, so the next read starts from nothing.
        queryClient.removeQueries({ queryKey: HOME_QUERY.queryKey });
        void navigate({ to: "/drill", search: { kind: "placement" } });
      }}
    />
  );
}
