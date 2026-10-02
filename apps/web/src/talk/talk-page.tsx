import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { PageLoadFailed, PageLoading } from "../lib/page-shell";
import { HOME_QUERY, isSignedOut } from "../lib/queries";
import { TalkSession } from "./talk-session";

/**
 * The `/talk` route. The home view says who is signed in and whether the ○
 * sound is on, as it does for the drill; the talk itself is read from
 * nothing, and lives only as long as the screen does — so once the view has
 * answered, a later refetch that fails never takes the screen away mid-talk.
 */
export function TalkPage(): ReactElement {
  const home = useQuery(HOME_QUERY);
  if (home.data !== undefined)
    return <TalkSession sound={home.data.sound} turnCount={home.data.talkTurns} />;
  if (home.isPending) return <PageLoading withNav />;
  if (isSignedOut(home.error)) return <Navigate to="/" replace />;
  return (
    <PageLoadFailed
      withNav
      onReload={() => {
        void home.refetch();
      }}
    />
  );
}
