import { useRouterState } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { LoadFailedPanel } from "../home/home-empty";
import { cn } from "./utils";
import { TabBar } from "./tab-bar";
import { useEscapeHome } from "./use-escape-home";

/**
 * A screen whose read has not answered yet: the empty column, and nothing in
 * it — no spinner and no pulsing placeholder (`designing-ui`). `withTabBar`
 * keeps a tab screen's bar standing while it reads, so switching tabs does
 * not blank it.
 */
export function PageLoading({
  withTabBar = false,
}: Readonly<{ withTabBar?: boolean }>): ReactElement {
  return (
    <>
      <main
        className={cn(
          "mx-auto box-content flex max-w-column px-4",
          withTabBar
            ? "min-h-[calc(var(--column-height)-var(--tab-bar-space))] pb-(--tab-bar-space)"
            : "min-h-(--column-height)",
        )}
      />
      {withTabBar ? <TabBar /> : null}
    </>
  );
}

/**
 * A screen whose read failed: say so, and read again on request. On a tab
 * screen the bar stays, and Esc goes home as the screen itself would.
 */
export function PageLoadFailed({
  onReload,
  withTabBar = false,
}: Readonly<{ onReload: () => void; withTabBar?: boolean }>): ReactElement {
  const atHome = useRouterState({ select: (state) => state.location.pathname === "/" });
  useEscapeHome(withTabBar && !atHome);
  return (
    <>
      <main
        className={cn(
          "mx-auto box-content flex max-w-column flex-col justify-center px-4 pt-8",
          withTabBar
            ? "min-h-[calc(var(--column-height)-var(--tab-bar-space)-4rem)] pb-[calc(var(--tab-bar-space)+2rem)]"
            : "min-h-[calc(var(--column-height)-4rem)] pb-8",
        )}
      >
        <LoadFailedPanel onReload={onReload} />
      </main>
      {withTabBar ? <TabBar /> : null}
    </>
  );
}
