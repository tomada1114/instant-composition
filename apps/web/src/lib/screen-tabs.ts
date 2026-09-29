/** The settings screen's tabs, in order; the first is the one a bare `/settings` opens. */
export const SETTINGS_TABS = ["cards", "level", "app"] as const;

/** The records screen's tabs, in order; the first is the one a bare `/records` opens. */
export const RECORDS_TABS = ["overview", "weak", "history"] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];
export type RecordsTab = (typeof RECORDS_TABS)[number];

/**
 * The route's search for a `?tab=` value: the tab it names, or `undefined`
 * when it names none of `tabs`. Set rather than left out, since the root's
 * search would otherwise carry the unknown value through.
 */
export function tabSearch<T extends string>(
  tabs: readonly T[],
  value: unknown,
): { tab?: T | undefined } {
  return { tab: tabs.find((candidate) => candidate === value) };
}

/**
 * The tab an address opens, read from its query string, and whether that
 * string carries a `?tab=` naming none of `tabs` — which the route replaces
 * with the bare path. Read from the address alone, so the two never disagree
 * mid-navigation.
 */
export function addressedTab<T extends string>(
  tabs: readonly [T, ...T[]],
  searchStr: string,
): { tab: T; stray: boolean } {
  const value = new URLSearchParams(searchStr).get("tab");
  const tab = tabs.find((candidate) => candidate === value);
  return { tab: tab ?? tabs[0], stray: value !== null && tab === undefined };
}

/**
 * The search that opens `tab`: none for the first, so choosing it writes the
 * bare path, the same address a link to the screen uses.
 */
export function searchFor<T extends string>(
  tabs: readonly [T, ...T[]],
  tab: T,
): { tab?: T } {
  return tab === tabs[0] ? {} : { tab };
}
