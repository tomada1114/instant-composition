import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";

import { RecapScreen } from "../../../components/summary/recap-screen";
import { LOCALES } from "../../../i18n/locales";
import { redirect } from "../../../i18n/navigation";
import { getServices } from "../../../server/composition";

/** It reads the progress database on every request, so it is never prerendered. */
export const dynamic = "force-dynamic";

/** W9r: today's last finished round's summary; with none yet, the start screen. */
export default async function RecapPage({
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

  const summary = getServices().recap();
  if (summary === undefined) {
    return redirect({ href: "/", locale });
  }
  return <RecapScreen summary={summary} />;
}
