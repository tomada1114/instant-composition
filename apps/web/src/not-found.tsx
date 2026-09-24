import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

/**
 * A path this client has no screen for. The records, recap, settings and
 * welcome routes render it too until their screens are ported (#43), so a link
 * to one lands here rather than on a blank page.
 */
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
