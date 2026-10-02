import { useTranslations } from "use-intl";
import type { ReactElement } from "react";

import type { RoundPayload } from "../openapi";
import { Button } from "../ui/button";
import { Eyebrow } from "../ui/eyebrow";
import { ArrowGlyph } from "../ui/glyphs";
import { Kbd } from "../ui/kbd";

/** W2: the three moves of a card, once, before the placement round — in a row from `sm`. */
export function IntroScreen({
  first,
  round,
  onStart,
}: Readonly<{
  first: boolean;
  round: Pick<RoundPayload, "deck">;
  onStart: () => void;
}>): ReactElement {
  const t = useTranslations("Drill.intro");
  const count = round.deck.length;
  const steps = [t("say"), t("flip"), t("grade")];
  return (
    <div className="flex w-full flex-col items-center gap-10 py-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <Eyebrow aria-hidden>{t("eyebrow")}</Eyebrow>
        <h1 className="text-heading">
          {first ? t("titleFirst", { count }) : t("titleAgain", { count })}
        </h1>
      </div>
      <ol className="grid w-full gap-4 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li
            key={step}
            className="flex items-baseline gap-5 rounded-panel border-2 border-border bg-card p-6 sm:flex-col sm:gap-3"
          >
            <span aria-hidden className="font-latin text-count text-muted-foreground">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="text-heading">{step}</span>
          </li>
        ))}
      </ol>
      <Button className="w-full max-w-progress" onClick={onStart}>
        {t("start")}
        <ArrowGlyph className="size-4.5" />
        <Kbd>Space</Kbd>
      </Button>
    </div>
  );
}
