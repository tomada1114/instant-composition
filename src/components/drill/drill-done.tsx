import { useTranslations } from "next-intl";
import { useEffect, useRef, type ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { NoticeGlyph } from "@/components/ui/glyphs";

import { Link } from "../../i18n/navigation";
import type { FinishState } from "./use-drill";

const SHELL =
  "mx-auto box-content flex min-h-[calc(100dvh-4rem)] max-w-column flex-col gap-4 px-4 py-8";

/**
 * Where a round ends: the summary once the server has it, or the notice that
 * the records are not saved yet with a way to send them again.
 */
export function DrillDone({
  finish,
  unsaved,
}: Readonly<{ finish: FinishState; unsaved: number }>): ReactElement {
  const t = useTranslations("Drill");
  const heading = useRef<HTMLHeadingElement>(null);
  const done = finish.status === "done";

  useEffect(() => {
    if (done) heading.current?.focus();
  }, [done]);

  if (finish.status === "failed") {
    return (
      <main className={SHELL}>
        <div className="flex items-center gap-3 rounded-tile bg-raised px-4 py-3">
          <NoticeGlyph />
          <p className="flex-1">{t("save.unsaved", { count: unsaved })}</p>
          <Button variant="text" className="px-2" onClick={finish.retry}>
            {t("save.resend")}
          </Button>
        </div>
      </main>
    );
  }
  if (!done) return <main className={SHELL} />;
  return (
    <main className={SHELL}>
      <h1 ref={heading} tabIndex={-1} className="focus-visible:outline-none">
        {t("done.title")}
      </h1>
      <div className="mt-auto">
        <Button asChild className="w-full">
          <Link href="/">{t("done.end")}</Link>
        </Button>
      </div>
    </main>
  );
}
