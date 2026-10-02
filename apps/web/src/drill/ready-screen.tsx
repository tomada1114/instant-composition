import { useTranslations } from "use-intl";
import type { ReactElement } from "react";

import type { RoundKind } from "../openapi";
import { Button } from "../ui/button";
import { Eyebrow } from "../ui/eyebrow";
import { ArrowGlyph } from "../ui/glyphs";
import { Kbd } from "../ui/kbd";

/**
 * A round nobody started with a press: it names itself and waits for one,
 * centred on the stage with "start" under it.
 */
export function ReadyScreen({
  kind,
  count,
  position,
  onStart,
}: Readonly<{
  kind: RoundKind;
  count: number;
  /** The first pass the round resumes on, counted from 1 across the round. */
  position: number;
  onStart: () => void;
}>): ReactElement {
  const t = useTranslations("Drill.ready");
  // The same place and count the card screen's top strip shows.
  return (
    <div className="flex w-full flex-col items-center gap-10 py-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <Eyebrow aria-hidden>{t("eyebrow", { kind })}</Eyebrow>
        <h1 className="text-heading">{t("title", { kind, count })}</h1>
        <p className="font-latin text-count text-muted-foreground">
          {t("resume", { position, total: count })}
        </p>
      </div>
      <Button className="w-full max-w-progress" onClick={onStart}>
        {t("start")}
        <ArrowGlyph className="size-4.5" />
        <Kbd>Space</Kbd>
      </Button>
    </div>
  );
}
