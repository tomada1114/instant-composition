import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { Button } from "../ui/button";
import { Eyebrow } from "../ui/eyebrow";
import { ArrowGlyph } from "../ui/glyphs";
import { Kbd } from "../ui/kbd";
import { TALK_TURNS } from "./talk-state";

/**
 * W2: the six turns as the screen's figure, and the panel at the bottom with
 * 「始める」 — 「用意しています」 while the scene is made, with no spinner — or,
 * when it could not be made, the heading and 「もう一度」.
 */
export function TalkStart({
  status,
  onStart,
}: Readonly<{
  status: "idle" | "preparing" | "failed";
  onStart: () => void;
}>): ReactElement {
  const t = useTranslations("Talk.start");
  return (
    <main className="mx-auto box-content flex min-h-[calc(var(--column-height)-var(--tab-bar-space)-1.75rem)] max-w-column flex-col gap-8 px-4 pt-4 pb-[calc(var(--tab-bar-space)+0.75rem)]">
      <h1>
        <Eyebrow>{t("title")}</Eyebrow>
      </h1>
      <p className="my-auto flex flex-col items-center gap-2">
        <span className="font-display text-number-xl">{TALK_TURNS}</span>
        <span className="font-mono text-mono-sm text-muted-foreground">
          {t("turns")}
        </span>
      </p>
      <section className="-mx-1 mt-auto flex flex-col gap-5 rounded-card bg-card p-5">
        {status === "failed" ? (
          <>
            <h2 className="text-heading">{t("failed")}</h2>
            <Button
              variant="secondary"
              data-primary
              className="w-full"
              onClick={onStart}
            >
              {t("retry")}
              <Kbd>Enter</Kbd>
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">{t("scene")}</p>
            <Button
              data-primary
              className="w-full"
              disabled={status === "preparing"}
              onClick={onStart}
            >
              {status === "preparing" ? (
                t("preparing")
              ) : (
                <>
                  {t("go")}
                  <ArrowGlyph className="size-4.5" />
                  <Kbd>Enter</Kbd>
                </>
              )}
            </Button>
          </>
        )}
      </section>
    </main>
  );
}
