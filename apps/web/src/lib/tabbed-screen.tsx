import { useId, type ReactElement, type ReactNode } from "react";

import { TabPanel, Tabs, type TabOption } from "../ui/tabs";
import { useShellNav } from "./frame";

/**
 * A hub screen split into `tabs`: the heading, the tabs, and the current
 * tab's panel, as tall as its content, under the shell's navigation.
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
  useShellNav();
  return (
    <div className="mx-auto flex w-full max-w-reading flex-col gap-6">
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
      <TabPanel id={tabsId} value={tab} className="flex flex-col gap-6">
        {children}
      </TabPanel>
    </div>
  );
}
