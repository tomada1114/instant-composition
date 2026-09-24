import { useTranslations } from "use-intl";
import type { ReactElement } from "react";

import { Button } from "../ui/button";
import { Eyebrow } from "../ui/eyebrow";
import { ArrowGlyph } from "../ui/glyphs";
import { Kbd } from "../ui/kbd";

/** W2: the three moves of a card, once, before the placement round. */
export function IntroScreen({
  first,
  count,
  onStart,
}: Readonly<{ first: boolean; count: number; onStart: () => void }>): ReactElement {
  const t = useTranslations("Drill.intro");
  const steps = [t("say"), t("flip"), t("grade")];
  return (
    <main className="mx-auto box-content flex min-h-[calc(100dvh-2rem)] max-w-column flex-col px-4 pt-8 pb-3">
      <div className="flex flex-col gap-3">
        <Eyebrow aria-hidden>{t("eyebrow")}</Eyebrow>
        <h1 className="text-heading">
          {first ? t("titleFirst", { count }) : t("titleAgain", { count })}
        </h1>
      </div>
      <ol className="my-auto border-t border-border py-10">
        {steps.map((step, index) => (
          <li
            key={step}
            className="flex items-baseline gap-5 border-b border-border py-5"
          >
            <span aria-hidden className="font-mono text-mono-sm text-muted-foreground">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="text-heading">{step}</span>
          </li>
        ))}
      </ol>
      <Button className="w-full" onClick={onStart}>
        {t("start")}
        <ArrowGlyph className="size-4.5" />
        <Kbd>Space</Kbd>
      </Button>
    </main>
  );
}
