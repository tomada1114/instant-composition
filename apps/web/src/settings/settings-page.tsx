import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";

import { PageLoadFailed, PageLoading } from "../lib/page-shell";
import { SETTINGS_QUERY } from "../lib/queries";
import { SettingsScreen } from "./settings-screen";

/**
 * The `/settings` route: the settings as saved now. The screen starts from
 * what this visit read, never from a cached copy, since it saves on top of it.
 */
export function SettingsPage(): ReactElement {
  const page = useQuery({ ...SETTINGS_QUERY, refetchOnMount: "always" });

  if (!page.isFetchedAfterMount) return <PageLoading />;
  if (page.isError || page.data === undefined) {
    return (
      <PageLoadFailed
        onReload={() => {
          void page.refetch();
        }}
      />
    );
  }
  return <SettingsScreen page={page.data} />;
}
