import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { lastFinishedRound } from "../lib/last-round";
import { PageLoadFailed, PageLoading } from "../lib/page-shell";
import { errorCodeOf, readRoundSummary } from "../lib/queries";
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
 * The `/recap` route: the summary of the last round this client finished.
 * With none remembered, or one the API no longer has, it is the start
 * screen's.
 */
export function RecapPage(): ReactElement {
  const roundId = lastFinishedRound();
  const summary = useQuery({
    queryKey: ["round-summary", roundId],
    queryFn: () => readRoundSummary(roundId ?? ""),
    enabled: roundId !== undefined,
  });

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
