import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { usePrimaryKey } from "../lib/use-primary-key";
import { Button } from "../ui/button";
import { Eyebrow } from "../ui/eyebrow";
import { ArrowGlyph } from "../ui/glyphs";
import { Kbd } from "../ui/kbd";

/** The right column: a drill card's front as the product's own face, run part way down its timer. Decoration only. */
function SampleCard(): ReactElement {
  const t = useTranslations("Landing.sample");
  return (
    <div aria-hidden className="flex flex-col gap-6">
      <div className="flex min-h-72 flex-col gap-6 rounded-panel border-2 border-border bg-card p-8">
        <Eyebrow>{t("topic")}</Eyebrow>
        <p className="my-auto text-center text-front text-balance">{t("prompt")}</p>
      </div>
      <div className="flex items-center gap-4">
        <span className="h-3 flex-1 overflow-hidden rounded-full bg-bar-track">
          <span className="block h-full w-3/5 rounded-full bg-energy" />
        </span>
        <span className="w-8 text-right font-display text-figure-sm tabular-nums">
          18
        </span>
      </div>
    </div>
  );
}

/**
 * `/` for a visitor who is not signed in: from `pc`, two columns inside the
 * dashboard width — the brand, the name, the drill's three moves and sign-in
 * as the one action at the left, a static sample card at the right; one
 * column below. It reads nothing, so it has no learner data to show, and it
 * carries no navigation.
 */
export function LandingScreen(): ReactElement {
  const t = useTranslations("Landing");
  const steps = [t("steps.read"), t("steps.say"), t("steps.grade")];
  usePrimaryKey();

  return (
    <div className="mx-auto grid w-full max-w-dashboard grid-cols-1 gap-10 pc:min-h-[calc(100dvh-5rem)] pc:grid-cols-2 pc:content-center pc:items-center pc:gap-6">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <p className="font-display text-figure-sm">{t("brand")}</p>
          <h1 className="text-heading">{t("title")}</h1>
        </div>
        <ol className="flex flex-col gap-4">
          {steps.map((step, index) => (
            <li key={step} className="flex items-baseline gap-4">
              <span aria-hidden className="w-6 font-display text-figure-sm">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        {/* A link to the sign-in page rather than a button: it says where it
            goes and opens in a new tab on request. */}
        <Button asChild className="w-full sm:w-80">
          <Link to="/login" data-primary>
            {t("signIn")}
            <ArrowGlyph className="size-4.5" />
            <Kbd>Space</Kbd>
          </Link>
        </Button>
      </div>
      <SampleCard />
    </div>
  );
}
