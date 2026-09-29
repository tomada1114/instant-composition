/** The settings screen's tabs, in order; the first is the one a bare `/settings` opens. */
export const SETTINGS_TABS = ["cards", "level", "app"] as const;

/** The records screen's tabs, in order; the first is the one a bare `/records` opens. */
export const RECORDS_TABS = ["overview", "weak", "history"] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];
export type RecordsTab = (typeof RECORDS_TABS)[number];

/**
 * The route's search for a `?tab=` value: the tab it names, or `undefined`
 * when it names none of `tabs`. Set rather than left out, since the root's
 * search would otherwise carry the unknown value through; an `undefined`
 * never reaches the address, so a bare `/settings` stays bare.
 */
export function tabSearch<T extends string>(
  tabs: readonly T[],
  value: unknown,
): { tab?: T | undefined } {
  return { tab: tabs.find((candidate) => candidate === value) };
}
