import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";

import { PageLoadFailed, PageLoading } from "../lib/page-shell";
import { RECORDS_QUERY } from "../lib/queries";
import { RecordsScreen } from "./records-screen";

/** The `/records` route: the records as the API has them now, never a cached copy. */
export function RecordsPage(): ReactElement {
  const records = useQuery({ ...RECORDS_QUERY, refetchOnMount: "always" });

  if (!records.isFetchedAfterMount) return <PageLoading />;
  if (records.isError || records.data === undefined) {
    return (
      <PageLoadFailed
        onReload={() => {
          void records.refetch();
        }}
      />
    );
  }
  return <RecordsScreen records={records.data} />;
}
