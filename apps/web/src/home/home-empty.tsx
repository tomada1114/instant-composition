import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { Button } from "../ui/button";

/** W3d: too few reviewed cards to deal from; no start, a way to widen the choice. */
export function NotEnoughPanel({
  available,
}: Readonly<{ available: number }>): ReactElement {
  const t = useTranslations("Home.notEnough");
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-heading">{t("title")}</h2>
        <p className="text-muted-foreground">{t("body", { count: available })}</p>
      </div>
      <Button asChild variant="secondary">
        <Link to="/settings">{t("widen")}</Link>
      </Button>
    </div>
  );
}

/** The cards could not be read at all: say so, and load again on request. */
export function LoadFailedPanel({
  onReload,
}: Readonly<{ onReload: () => void }>): ReactElement {
  const t = useTranslations("Home.loadFailed");
  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-heading">{t("title")}</h2>
      <Button data-primary variant="secondary" onClick={onReload}>
        {t("reload")}
      </Button>
    </div>
  );
}
