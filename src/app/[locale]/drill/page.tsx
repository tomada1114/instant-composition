import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";

import { DrillScreen } from "../../../components/drill/drill-screen";
import { LOCALES } from "../../../i18n/locales";
import { getServices } from "../../../server/composition";

/** It reads the progress database on every request, so it is never prerendered. */
export const dynamic = "force-dynamic";

/**
 * One round: `?kind=` picks today's portion (the default), yesterday's, an
 * extra round, or the placement. The client reads it and fetches the round,
 * since it is what times the cards.
 */
export default async function DrillPage({
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

  const home = getServices().home();
  return <DrillScreen first={home.state.kind === "placement"} sound={home.sound} />;
}
