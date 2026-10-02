import { useRouterState } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { LoadFailedPanel } from "../home/home-empty";
import { useShellNav } from "./frame";
import { useEscapeHome } from "./use-escape-home";

/**
 * A screen whose read has not answered yet: nothing in `main` — no spinner
 * and no pulsing placeholder (`designing-ui`). `withNav` keeps a hub screen's
 * navigation standing while it reads, so moving between sections does not
 * blank it.
 */
export function PageLoading({
  withNav = false,
}: Readonly<{ withNav?: boolean }>): null {
  useShellNav(withNav);
  return null;
}

/**
 * A screen whose read failed: say so, and read again on request. On a hub
 * screen the navigation stays, and Esc goes home as the screen itself would.
 */
export function PageLoadFailed({
  onReload,
  withNav = false,
}: Readonly<{ onReload: () => void; withNav?: boolean }>): ReactElement {
  const atHome = useRouterState({ select: (state) => state.location.pathname === "/" });
  useEscapeHome(withNav && !atHome);
  useShellNav(withNav);
  return (
    <div className="mx-auto flex w-full max-w-reading flex-col justify-center">
      <LoadFailedPanel onReload={onReload} />
    </div>
  );
}
