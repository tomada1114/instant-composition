import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { useShellNav } from "../lib/frame";
import { Button } from "../ui/button";
import { Eyebrow } from "../ui/eyebrow";
import { ArrowGlyph } from "../ui/glyphs";
import { Kbd } from "../ui/kbd";

/** The six steps of one turn, as one line of labels under W2's panel. */
function TurnFlow(): ReactElement {
  const t = useTranslations("Talk");
  const steps = [
    t("speaker.partner"),
    t("step.japanese"),
    t("step.english"),
    t("start.model"),
    t("start.again"),
    t("speaker.partner"),
  ];
  return (
    <ol
      aria-label={t("start.flow")}
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-caption text-muted-foreground"
    >
      {steps.map((step, index) => (
        <li key={index} className="flex items-center gap-2">
          {index > 0 ? <ArrowGlyph className="size-3.5" /> : null}
          {step}
        </li>
      ))}
    </ol>
  );
}

/**
 * W2, in the shell: one panel with the title, the six turns as its figure,
 * the scene left to the app and 「始める」 — 「用意しています」 while the scene
 * is made, with no spinner — or, when it could not be made, the heading and
 * 「もう一度」; under it, the six steps of a turn.
 */
export function TalkStart({
  status,
  turnCount,
  onStart,
}: Readonly<{
  status: "idle" | "preparing" | "failed";
  turnCount: number;
  onStart: () => void;
}>): ReactElement {
  const t = useTranslations("Talk.start");
  useShellNav();
  return (
    <div className="mx-auto flex w-full max-w-reading flex-col gap-5">
      <section className="flex flex-col gap-6 rounded-card border-2 border-border bg-card p-6">
        <h1>
          <Eyebrow>{t("title")}</Eyebrow>
        </h1>
        <p className="flex flex-col items-center gap-2">
          <span className="font-display text-number-xl">{turnCount}</span>
          <span className="font-latin text-count text-muted-foreground">
            {t("turns")}
          </span>
        </p>
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
      <TurnFlow />
    </div>
  );
}
