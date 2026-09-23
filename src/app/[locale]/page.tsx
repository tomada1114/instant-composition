import { hasLocale, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { use, type ReactElement } from "react";

import { LOCALES } from "../../i18n/locales";

/**
 * The one page this app ships so far, translated.
 *
 * @remarks
 * It carries no language switch: the app ships a single locale, and a switch
 * with one entry is dead UI. `Link` from `src/i18n/navigation.ts` is what a
 * switch uses once a second locale exists.
 */
export default function HomePage({
  params,
}: Readonly<{
  params: Promise<{ locale: string }>;
}>): ReactElement {
  const { locale } = use(params);
  if (!hasLocale(LOCALES, locale)) {
    notFound();
  }
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- required by next-intl's legacy static-rendering API
  setRequestLocale(locale);

  const t = useTranslations("HomePage");
  const switcher = useTranslations("LocaleSwitcher");

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
      <h1>{t("title")}</h1>
      <p>{t("intro", { language: switcher(locale) })}</p>
      <p className="text-muted-foreground">
        {t("localeCount", { count: LOCALES.length })}
      </p>
    </main>
  );
}
