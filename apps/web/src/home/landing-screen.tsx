import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { LOGIN_URL } from "../lib/endpoints";
import { usePrimaryKey } from "../lib/use-primary-key";
import { Button } from "../ui/button";
import { Eyebrow } from "../ui/eyebrow";
import { ArrowGlyph } from "../ui/glyphs";
import { Kbd } from "../ui/kbd";

/**
 * `/` for a visitor who is not signed in: what the drill is, as its three
 * moves, and sign-in as the one action. It reads nothing, so it has no
 * learner data to show, and it carries no navigation.
 */
export function LandingScreen(): ReactElement {
  const t = useTranslations("Landing");
  const steps = [t("steps.read"), t("steps.say"), t("steps.grade")];
  usePrimaryKey();

  return (
    <div className="mx-auto flex w-full max-w-reading flex-col">
      <div className="flex flex-col gap-3">
        <Eyebrow>{t("brand")}</Eyebrow>
        <h1 className="text-heading">{t("title")}</h1>
      </div>
      <ol className="my-auto border-t border-border py-10">
        {steps.map((step, index) => (
          <li
            key={step}
            className="flex items-baseline gap-5 border-b border-border py-5"
          >
            <span aria-hidden className="font-latin text-count text-muted-foreground">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="text-heading">{step}</span>
          </li>
        ))}
      </ol>
      {/* A full-page navigation to the managed login, so a link rather than a
          button: it says where it goes and opens in a new tab on request. */}
      <Button asChild className="w-full">
        <a href={LOGIN_URL} data-primary>
          {t("signIn")}
          <ArrowGlyph className="size-4.5" />
          <Kbd>Space</Kbd>
        </a>
      </Button>
    </div>
  );
}
