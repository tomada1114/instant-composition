import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { isSignedOut, VOCAB_QUERY } from "../lib/queries";
import { PageLoading, PageLoadFailed } from "../lib/page-shell";
import { VocabScreen } from "./vocab-screen";
/** The hub always reads today's queue again after study or a settings change. */
export function VocabPage(): ReactElement {
  const hub = useQuery({ ...VOCAB_QUERY, refetchOnMount: "always" });
  if (isSignedOut(hub.error)) return <Navigate to="/" replace />;
  if (hub.isError)
    return (
      <PageLoadFailed
        withNav
        onReload={() => {
          void hub.refetch();
        }}
      />
    );
  if (!hub.isFetchedAfterMount || hub.data === undefined)
    return <PageLoading withNav />;
  return <VocabScreen hub={hub.data} />;
}
