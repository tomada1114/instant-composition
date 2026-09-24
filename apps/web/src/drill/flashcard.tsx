import { useTranslations } from "use-intl";
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";

import { cn } from "../lib/utils";
import { Eyebrow } from "../ui/eyebrow";
import { ReturnGlyph } from "../ui/glyphs";

import type { DrillCard } from "../openapi";
import { playMotion } from "./motion";

/** Past this many characters a prompt runs to a fourth line at `front`, so it drops to `front-long`. */
const FRONT_LONG_AFTER = 36;

/**
 * W4 and W4r: the prompt set large on the canvas itself — no card box — with
 * the "again" mark on a retry; empty while paused. The whole area flips.
 */
export function CardFront({
  card,
  retry,
  hidden,
  onFlip,
}: Readonly<{
  card: DrillCard;
  retry: boolean;
  hidden: boolean;
  onFlip?: () => void;
}>): ReactElement {
  const t = useTranslations("Drill.card");
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    playMotion(content.current, "fade");
  }, [card.id, retry]);

  return (
    <div
      data-part="card"
      onClick={onFlip}
      className="flex min-h-0 flex-1 flex-col justify-center pb-12"
    >
      {hidden ? null : (
        <div ref={content} className="flex flex-col items-start gap-5">
          {retry ? (
            <Eyebrow className="flex items-center gap-1.5">
              <ReturnGlyph className="size-3.5" />
              {t("again")}
            </Eyebrow>
          ) : null}
          <p
            className={cn(
              "text-balance",
              card.prompt.length > FRONT_LONG_AFTER ? "text-front-long" : "text-front",
            )}
          >
            {card.prompt}
          </p>
        </div>
      )}
    </div>
  );
}

function BackFooter({
  mode,
  elapsedMs,
  fast,
}: Readonly<{
  mode: "self" | "timeout";
  elapsedMs: number;
  fast: boolean;
}>): ReactElement {
  const t = useTranslations("Drill.card");
  const mark = useRef<HTMLSpanElement>(null);
  const seconds = Math.round(elapsedMs / 100) / 10;

  useEffect(() => {
    if (fast) playMotion(mark.current, "chip");
  }, [fast]);

  if (mode === "timeout") {
    return (
      <p className="flex items-center gap-2 text-label text-muted-foreground">
        <ReturnGlyph className="size-4" />
        <span>{t("timedOut")}</span>
        <span aria-hidden>・</span>
        <span>{t("review")}</span>
      </p>
    );
  }
  return (
    <p className="flex justify-end">
      {fast ? (
        <span ref={mark} className="font-display text-figure-sm text-accent">
          {t("fast", { seconds })}
        </span>
      ) : (
        <span className="font-display text-figure-sm">{t("seconds", { seconds })}</span>
      )}
    </p>
  );
}

/**
 * W5, W6 and W7: the answer to read, top to bottom — the whole prompt, the
 * model answer, the alternates between hairlines, the key point. Only this
 * area scrolls when it does not fit; it then takes focus, and ↑/↓ scroll it
 * by `data-part`.
 */
export function CardBack({
  card,
  mode,
  elapsedMs,
  feedback,
  hidden = false,
}: Readonly<{
  card: DrillCard;
  mode: "self" | "timeout";
  elapsedMs: number;
  feedback?: { readonly result: "ok" | "ng"; readonly fast: boolean };
  hidden?: boolean;
}>): ReactElement {
  const t = useTranslations("Drill.card");
  const area = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const element = area.current;
    if (element !== null) setOverflowing(element.scrollHeight > element.clientHeight);
    playMotion(element, "rise");
  }, [card.id]);

  return (
    <div data-part="card" className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={area}
        data-part="back-scroll"
        tabIndex={overflowing ? 0 : undefined}
        className={cn(
          "-mx-2 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-2 pt-5 pb-2",
          hidden && "invisible",
        )}
      >
        <p className="text-point text-muted-foreground">{card.prompt}</p>
        <p
          lang="en"
          className={cn(
            "font-latin text-answer transition-colors duration-160",
            feedback?.result === "ok" && "text-accent",
            feedback?.result === "ng" && "text-muted-foreground",
          )}
        >
          {card.text}
        </p>
        {card.alternatives.length > 0 ? (
          <ul className="border-t border-border">
            {card.alternatives.map((alternative) => (
              <li
                key={alternative}
                lang="en"
                className="border-b border-border py-3 font-latin text-alt text-soft"
              >
                {alternative}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-point text-muted-foreground">
          <span className="mr-2 text-label text-foreground">{t("point")}</span>
          {card.explanation}
        </p>
        <div className="mt-auto pt-2">
          <BackFooter
            mode={mode}
            elapsedMs={elapsedMs}
            fast={feedback?.fast ?? false}
          />
        </div>
      </div>
      {overflowing ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-b from-transparent to-background"
        />
      ) : null}
    </div>
  );
}
