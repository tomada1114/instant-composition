import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";

import { SettingsScreen } from "../../../components/settings/settings-screen";
import { LOCALES } from "../../../i18n/locales";
import { getServices } from "../../../server/composition";

/** It reads the progress database on every request, so it is never prerendered. */
export const dynamic = "force-dynamic";

/** W11, the settings, with W12's confirmation over it. */
export default async function SettingsPage({
  params,
}: Readonly<{
  params: Promise<{ locale: string }>;
}>): Promise<ReactElement> {
  const { locale } = await params;
  if (!hasLocale(LOCALES, locale)) {
    notFound();
  }
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- required by next-intl's legacy static-rendering API
  setRequestLocale(locale);

  return <SettingsScreen page={getServices().settingsPage()} />;
}
