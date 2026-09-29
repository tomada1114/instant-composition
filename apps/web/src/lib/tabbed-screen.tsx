import { useId, type ReactElement, type ReactNode } from "react";

import { TabPanel, Tabs, type TabOption } from "../ui/tabs";
import { TabBar } from "./tab-bar";

/**
 * A hub screen split into `tabs` (`designing-ui`): the heading, the tabs, and
 * the current tab's panel, the column's height less the tab bar, so a tab
 * that fits never scrolls the page. The panel is a flex column that takes
 * what is left; a list inside it that cannot fit gives itself
 * `min-h-0 flex-1 overflow-y-auto` and scrolls on its own. `notice` sits
 * between the tabs and the panel, whichever tab is open.
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
      <main className="mx-auto box-content flex h-[calc(var(--column-height)-var(--tab-bar-space)-3rem)] max-w-column flex-col gap-6 px-4 pt-6 pb-[calc(var(--tab-bar-space)+1.5rem)]">
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
