import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { PageLoadFailed, PageLoading } from "../lib/page-shell";
import { errorCodeOf, HOME_QUERY, readRoundSummary } from "../lib/queries";
import type { RoundSummary } from "../openapi";
import { SummaryScreen } from "./summary-screen";

function ignore(): void {
  // W9r has no buttons below, so nothing asks for another round.
}

/** W9r: a finished round's summary read back from the server, every value final. */
export function RecapScreen({
  summary,
}: Readonly<{ summary: RoundSummary }>): ReactElement {
  const navigate = useNavigate();
  return (
    <SummaryScreen
      summary={summary}
      mode="recap"
      dailySize={0}
      onNext={ignore}
      onEnd={() => {
        void navigate({ to: "/" });
      }}
    />
  );
}

/** Refusals that mean there is nothing to read back, rather than a read that failed. */
const NOTHING_TO_READ: readonly string[] = ["ERR_ROUND_NOT_FOUND", "ERR_BAD_REQUEST"];

/**
 * The `/recap` route: the summary of today's last finished round, as the
 * home view names it, whichever browser finished it. A cached home view is
 * not acted on — it may predate the round — so nothing is read until a home
 * read made for this visit answers. With no round finished today, or one the
 * API no longer has, it is the start screen's.
 */
export function RecapPage(): ReactElement {
  const home = useQuery({ ...HOME_QUERY, refetchOnMount: "always" });
  const roundId = home.isFetchedAfterMount ? home.data?.todayLastRoundId : undefined;
  const summary = useQuery({
    queryKey: ["round-summary", roundId],
    queryFn: () => readRoundSummary(roundId ?? ""),
    enabled: roundId !== undefined,
  });

  if (!home.isFetchedAfterMount) return <PageLoading />;
  if (home.isError) {
    return (
      <PageLoadFailed
        onReload={() => {
          void home.refetch();
        }}
      />
    );
  }
  if (roundId === undefined) return <Navigate to="/" replace />;
  if (summary.isPending) return <PageLoading />;
  if (summary.isError) {
    if (NOTHING_TO_READ.includes(errorCodeOf(summary.error))) {
      return <Navigate to="/" replace />;
    }
    return (
      <PageLoadFailed
        onReload={() => {
          void summary.refetch();
        }}
      />
    );
  }
  return <RecapScreen summary={summary.data} />;
}
