import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { PageLoadFailed, PageLoading } from "../lib/page-shell";
import { isSignedOut, PROFILE_QUERY, SETTINGS_QUERY } from "../lib/queries";
import type { SettingsTab } from "../lib/screen-tabs";
import { SettingsScreen } from "./settings-screen";

/**
 * The `/settings` route: the settings as saved now. The screen starts from
 * what this visit read, never from a cached copy, since it saves on top of it.
 */
export function SettingsPage({ tab }: Readonly<{ tab: SettingsTab }>): ReactElement {
  const page = useQuery({ ...SETTINGS_QUERY, refetchOnMount: "always" });
  // The time zone row's read, once per visit rather than on every opening of
  // the app tab; nothing here waits for it.
  useQuery({ ...PROFILE_QUERY, refetchOnMount: "always" });

  if (!page.isFetchedAfterMount) return <PageLoading withNav />;
  if (isSignedOut(page.error)) return <Navigate to="/" replace />;
  if (page.isError || page.data === undefined) {
    return (
      <PageLoadFailed
        withNav
        onReload={() => {
          void page.refetch();
        }}
      />
    );
  }
  return <SettingsScreen page={page.data} tab={tab} />;
}
