import { useTranslations } from "next-intl";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";

import { Link } from "../../i18n/navigation";

/** W3d: too few reviewed cards to deal from; no start, a way to widen the choice. */
export function NotEnoughPanel({
  available,
}: Readonly<{ available: number }>): ReactElement {
  const t = useTranslations("Home.notEnough");
  return (
    <section className="flex flex-col items-start gap-4 rounded-card bg-card p-6">
      <h2>{t("title")}</h2>
      <p className="text-muted-foreground">{t("body", { count: available })}</p>
      <Button asChild variant="secondary">
        <Link href="/settings">{t("widen")}</Link>
      </Button>
    </section>
  );
}

/** The cards could not be read at all: say so, and load again on request. */
export function LoadFailedPanel({
  onReload,
}: Readonly<{ onReload: () => void }>): ReactElement {
  const t = useTranslations("Home.loadFailed");
  return (
    <section className="flex flex-col items-start gap-4 rounded-card bg-card p-6">
      <h2>{t("title")}</h2>
      <Button data-primary variant="secondary" onClick={onReload}>
        {t("reload")}
      </Button>
    </section>
  );
}
