import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";

import { WelcomeScreen } from "../../../components/home/welcome-screen";
import { LOCALES } from "../../../i18n/locales";
import { redirect } from "../../../i18n/navigation";
import { getServices } from "../../../server/composition";

/** It reads the progress database on every request, so it is never prerendered. */
export const dynamic = "force-dynamic";

/** W1, the first visit's topic choice; once topics are chosen it is the start screen's. */
export default async function WelcomePage({
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

  const services = getServices();
  if (services.home().state.kind !== "onboarding") {
    redirect({ href: "/", locale });
  }
  return <WelcomeScreen topics={services.topics()} />;
}
