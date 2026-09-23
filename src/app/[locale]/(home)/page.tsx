import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";

import { HomeScreen } from "../../../components/home/home-screen";
import { LOCALES } from "../../../i18n/locales";
import { redirect } from "../../../i18n/navigation";
import { getServices } from "../../../server/composition";

/** It reads the progress database on every request, so it is never prerendered. */
export const dynamic = "force-dynamic";

/**
 * W3, the start screen. A first visit has nothing to show yet, so it goes on
 * to picking topics, and a visit before the placement round is done goes on
 * to that round.
 */
export default async function HomePage({
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

  const view = getServices().home();
  if (view.state.kind === "onboarding") {
    redirect({ href: "/welcome", locale });
  }
  if (view.state.kind === "placement") {
    redirect({ href: "/drill?kind=placement", locale });
  }
  return <HomeScreen view={view} />;
}
