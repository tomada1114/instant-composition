import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactElement } from "react";

import { ApiRequestError, HOME_QUERY, isSignedOut } from "../lib/queries";
import type { RoundKind } from "../openapi";
import { DrillError } from "./drill-error";
import { DrillScreen } from "./drill-screen";
import { clearPressed, wasPressed } from "./pressed";

/**
 * The `/drill` route: one round of the `?kind=` it names. The home view says
 * whether this is the first placement, whether sound is on, which keys grade
 * and how big "one more" is; it is read before the round starts, because
 * starting it changes what the home view says.
 */
export function DrillPage({
  kind,
}: Readonly<{ kind: RoundKind }>): ReactElement | null {
  const home = useQuery(HOME_QUERY);
  const navigate = useNavigate();
  // Spent on arrival, whatever this page shows next, so no later visit inherits it.
  const [pressed] = useState(wasPressed);
  useEffect(clearPressed, []);

  if (home.isPending) return null;
  if (isSignedOut(home.error)) return <Navigate to="/" replace />;
  if (home.isError) {
    return (
      <DrillError
        error={{
          code: home.error instanceof ApiRequestError ? home.error.code : "ERR_NETWORK",
        }}
        available={undefined}
        onReload={() => {
          void home.refetch();
        }}
      />
    );
  }
  const view = home.data;
  return (
    <DrillScreen
      kind={kind}
      pressed={pressed}
      first={view.state.kind === "placement"}
      sound={view.sound}
      gradeKeys={view.gradeKeys}
      dailySize={view.dailySize}
      dayBoundaryHour={view.dayBoundaryHour}
      available={view.state.kind === "not-enough" ? view.state.available : undefined}
      onKind={(next) => {
        void navigate({ to: "/drill", search: { kind: next } });
      }}
    />
  );
}
