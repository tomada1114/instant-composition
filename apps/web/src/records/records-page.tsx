import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { PageLoadFailed, PageLoading } from "../lib/page-shell";
import { isSignedOut, RECORDS_QUERY } from "../lib/queries";
import type { RecordsTab } from "../lib/screen-tabs";
import { RecordsScreen } from "./records-screen";

/** The `/records` route: the records as the API has them now, never a cached copy. */
export function RecordsPage({ tab }: Readonly<{ tab: RecordsTab }>): ReactElement {
  const records = useQuery({ ...RECORDS_QUERY, refetchOnMount: "always" });

  if (!records.isFetchedAfterMount) return <PageLoading withTabBar />;
  if (isSignedOut(records.error)) return <Navigate to="/" replace />;
  if (records.isError || records.data === undefined) {
    return (
      <PageLoadFailed
        withTabBar
        onReload={() => {
          void records.refetch();
        }}
      />
    );
  }
  return <RecordsScreen records={records.data} tab={tab} />;
}
