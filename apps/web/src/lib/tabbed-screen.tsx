import { useId, type ReactElement, type ReactNode } from "react";

import { TabPanel, Tabs, type TabOption } from "../ui/tabs";
import { TabBar } from "./tab-bar";

/**
 * A region inside a tab that scrolls on its own: it takes what height the
 * panel leaves (give it a `min-h-*` for the least it may shrink to), and
 * `contain-size` keeps its rows out of the screen's own height, so the screen
 * grows past the column only by what the rest of the tab needs.
 */
export const SELF_SCROLL = "flex-1 overflow-y-auto contain-size";

/**
 * A hub screen split into `tabs` (`designing-ui`): the heading, the tabs, and
 * the current tab's panel. The screen is at least the column's height, the
 * tab bar's space being its bottom padding, and otherwise its content's: a tab
 * that fits never scrolls the page, and a `SELF_SCROLL` region in it grows
 * into what is left. Where the rest of a tab does not fit — a short phone, a
 * phone on its side, a PC window under 640 tall — the screen grows, the page
 * scrolls, and every control still ends above the bar.
 * `notice` sits between the tabs and the panel, whichever tab is open.
 */
export function TabbedScreen<T extends string>({
  title,
  tabs,
  tab,
  onTab,
  notice,
  children,
}: Readonly<{
  title: string;
  tabs: readonly TabOption<T>[];
  tab: T;
  onTab: (tab: T) => void;
  notice?: ReactNode;
  children: ReactNode;
}>): ReactElement {
  const titleId = useId();
  const tabsId = useId();
  return (
    <>
      <main className="mx-auto box-content flex min-h-[calc(var(--column-height)-var(--tab-bar-space)-3rem)] max-w-column flex-col gap-6 px-4 pt-6 pb-[calc(var(--tab-bar-space)+1.5rem)]">
        <div className="flex flex-col gap-3">
          <h1 id={titleId}>{title}</h1>
          <Tabs
            id={tabsId}
            labelledBy={titleId}
            options={tabs}
            value={tab}
            onChange={onTab}
          />
        </div>
        {notice}
        <TabPanel
          id={tabsId}
          value={tab}
          className="flex min-h-0 flex-1 flex-col gap-6"
        >
          {children}
        </TabPanel>
      </main>
      <TabBar />
    </>
  );
}
