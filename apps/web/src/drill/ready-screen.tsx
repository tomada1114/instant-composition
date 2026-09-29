import { useTranslations } from "use-intl";
import type { ReactElement } from "react";

import type { RoundKind } from "../openapi";
import { Button } from "../ui/button";
import { Eyebrow } from "../ui/eyebrow";
import { ArrowGlyph } from "../ui/glyphs";
import { Kbd } from "../ui/kbd";

/** A round nobody started with a press: it names itself and waits for one. */
export function ReadyScreen({
  kind,
  count,
  position,
  onStart,
}: Readonly<{
  kind: RoundKind;
  count: number;
  position: number;
  onStart: () => void;
}>): ReactElement {
  const t = useTranslations("Drill.ready");
  return (
    <main className="mx-auto box-content flex min-h-[calc(var(--column-height)-2rem)] max-w-column flex-col px-4 pt-8 pb-3">
      <div className="my-auto flex flex-col gap-3">
        <Eyebrow aria-hidden>{t("eyebrow", { kind })}</Eyebrow>
        <h1 className="text-heading">{t("title", { kind, count })}</h1>
        <p className="font-mono text-mono-sm text-muted-foreground">
          {t("resume", { position, total: count })}
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
