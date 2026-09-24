import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { ApiRequestError, HOME_QUERY } from "../lib/queries";
import type { RoundKind } from "../openapi";
import { DrillError } from "./drill-error";
import { DrillScreen } from "./drill-screen";

const SHELL = "mx-auto box-content flex min-h-dvh max-w-column px-4";

/**
 * The `/drill` route: one round of the `?kind=` it names. The home view says
 * whether this is the first placement, whether sound is on and how big "one
 * more" is; it is read before the round starts, because starting it changes
 * what the home view says.
 */
export function DrillPage({ kind }: Readonly<{ kind: RoundKind }>): ReactElement {
  const home = useQuery(HOME_QUERY);
  const navigate = useNavigate();

  if (home.isPending) return <main className={SHELL} />;
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
      first={view.state.kind === "placement"}
      sound={view.sound}
      dailySize={view.dailySize}
      available={view.state.kind === "not-enough" ? view.state.available : undefined}
      onKind={(next) => {
        void navigate({ to: "/drill", search: { kind: next } });
      }}
    />
  );
}
