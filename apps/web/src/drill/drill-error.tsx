import { useTranslations } from "use-intl";
import type { ReactElement } from "react";

import { Link } from "@tanstack/react-router";

import type { ApiError } from "../lib/endpoints";
import { Button } from "../ui/button";

/**
 * The empty state where the card would be: too few cards, or none could be
 * loaded. The error envelope carries no count, so `available` is what the
 * home view last said could be dealt, and the line naming it is left out
 * when that is not known.
 */
export function DrillError({
  error,
  available,
  onReload,
}: Readonly<{
  error: ApiError;
  available: number | undefined;
  onReload: () => void;
}>): ReactElement {
  const t = useTranslations("Drill.error");
  const notEnough = error.code === "ERR_NOT_ENOUGH_CARDS";
  return (
    <main className="mx-auto box-content flex min-h-[calc(100dvh-4rem)] max-w-column flex-col justify-center px-4 py-8">
      <div className="flex flex-col gap-5 rounded-card bg-card p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-heading">
            {notEnough ? t("notEnoughTitle") : t("loadTitle")}
          </h1>
          {notEnough && available !== undefined ? (
            <p className="text-muted-foreground">
              {t("notEnough", { count: available })}
            </p>
          ) : null}
        </div>
        {notEnough ? (
          <Button asChild variant="secondary">
            <Link to="/settings">{t("widen")}</Link>
          </Button>
        ) : (
          <Button variant="secondary" onClick={onReload}>
            {t("reload")}
          </Button>
        )}
      </div>
    </main>
  );
}
