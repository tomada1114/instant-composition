import { useTranslations } from "next-intl";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";

import { Link } from "../../i18n/navigation";
import type { ApiError } from "./api";

/** The empty state where the card would be: too few cards, or none could be loaded. */
export function DrillError({
  error,
  onReload,
}: Readonly<{ error: ApiError; onReload: () => void }>): ReactElement {
  const t = useTranslations("Drill.error");
  const notEnough = error.code === "ERR_NOT_ENOUGH_CARDS";
  return (
    <main className="mx-auto box-content flex min-h-[calc(100dvh-4rem)] max-w-column flex-col justify-center px-4 py-8">
      <div className="flex flex-col items-start gap-4 rounded-card bg-card p-6">
        <h1>{notEnough ? t("notEnoughTitle") : t("loadTitle")}</h1>
        {notEnough ? (
          <>
            <p className="text-muted-foreground">
              {t("notEnough", { count: error.available ?? 0 })}
            </p>
            <Button asChild variant="secondary">
              <Link href="/settings">{t("widen")}</Link>
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onReload}>
            {t("reload")}
          </Button>
        )}
      </div>
    </main>
  );
}
