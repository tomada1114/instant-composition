import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import type { ReactElement, ReactNode } from "react";

import { LOCALES } from "../../../i18n/locales";

import { redirect } from "../../../i18n/navigation";
import { getServices } from "../../../server/composition";

/**
 * A first visit has nothing to show yet, so it goes on to picking topics, and
 * a visit before the placement round is done goes on to that round. Decided
 * here rather than in the page because the page renders inside `loading.tsx`'s
 * boundary, where a redirect can only be streamed; from here it is a 307.
 */
export default async function HomeLayout({
  children,
  params,
}: Readonly<{
  children: ReactNode;
  params: Promise<{ locale: string }>;
}>): Promise<ReactElement> {
  const { locale } = await params;
  if (!hasLocale(LOCALES, locale)) {
    notFound();
  }
  const kind = getServices().home().state.kind;
  if (kind === "onboarding") {
    redirect({ href: "/welcome", locale });
  }
  if (kind === "placement") {
    redirect({ href: "/drill?kind=placement", locale });
  }
  return <>{children}</>;
}
