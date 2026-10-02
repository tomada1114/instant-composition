import { useTranslations } from "use-intl";
import type { ReactElement } from "react";

import type { RoundKind } from "../openapi";
import type { progress } from "./drill-state";
import { Button } from "../ui/button";
import { Eyebrow } from "../ui/eyebrow";
import { ArrowGlyph } from "../ui/glyphs";
import { Kbd } from "../ui/kbd";

/** A round nobody started with a press: it names itself and waits for one. */
export function ReadyScreen({
  kind,
  count,
  where,
  offset,
  onStart,
}: Readonly<{
  kind: RoundKind;
  count: number;
  where: ReturnType<typeof progress>;
  offset: number;
  onStart: () => void;
}>): ReactElement {
  const t = useTranslations("Drill.ready");
  // The same place and count the card screen's top strip shows for this pass.
  return (
    <main className="mx-auto box-content flex min-h-[calc(var(--column-height)-var(--tab-bar-space)-2.75rem)] max-w-column flex-col px-4 pt-8 pb-[calc(var(--tab-bar-space)+0.75rem)]">
      <div className="my-auto flex flex-col gap-3">
        <Eyebrow aria-hidden>{t("eyebrow", { kind })}</Eyebrow>
        <h1 className="text-heading">{t("title", { kind, count })}</h1>
        <p className="font-latin text-count text-muted-foreground">
          {where.pass === "first"
            ? t("resume", { position: offset + where.position, total: count })
            : t("resumeRetry", { position: where.position, total: where.total })}
        </p>
      </div>
      <Button className="w-full" onClick={onStart}>
        {t("start")}
        <ArrowGlyph className="size-4.5" />
        <Kbd>Space</Kbd>
      </Button>
    </main>
  );
}
