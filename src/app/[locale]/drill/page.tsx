import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";

import { DrillScreen } from "../../../components/drill/drill-screen";
import { roundKindSchema } from "../../../core/api";
import { LOCALES } from "../../../i18n/locales";
import { getServices } from "../../../server/composition";

/** It reads the progress database on every request, so it is never prerendered. */
export const dynamic = "force-dynamic";

/**
 * One round: `?kind=` picks today's portion (the default), yesterday's,
 * an extra round, or the placement. The round itself is fetched by the
 * client, which is what times the cards.
 */
export default async function DrillPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ kind?: string | string[] }>;
}>): Promise<ReactElement> {
  const { locale } = await params;
  if (!hasLocale(LOCALES, locale)) {
    notFound();
  }
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- required by next-intl's legacy static-rendering API
  setRequestLocale(locale);

  const requested = roundKindSchema.safeParse((await searchParams).kind);
  const home = getServices().home();
  return (
    <DrillScreen
      kind={requested.success ? requested.data : "today"}
      first={home.state.kind === "placement"}
      sound={home.sound}
    />
  );
}
