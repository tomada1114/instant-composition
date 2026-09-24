import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

/** A path this client has no screen for. */
export function NotFound(): ReactElement {
  const t = useTranslations("NotFound");

  return (
    <main className="mx-auto flex max-w-2xl flex-col items-start gap-4 p-8">
      <h1>{t("title")}</h1>
      <p>{t("description")}</p>
      <Link to="/">{t("homeLink")}</Link>
    </main>
  );
}
