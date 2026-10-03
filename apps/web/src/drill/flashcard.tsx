import { useTranslations } from "use-intl";
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";

import { cn } from "../lib/utils";
import { Eyebrow } from "../ui/eyebrow";
import { ReturnGlyph } from "../ui/glyphs";

import type { DrillCard, Grade } from "../openapi";
import { playMotion } from "../study/motion";

/**
 * Past this many characters a prompt runs to a third line at `front` (36px)
 * on the 880 stage's card, about 24 characters a line, so it drops to
 * `front-long` — `designing-ui`'s foundations hold the scale.
 */
const FRONT_LONG_AFTER = 48;

/**
 * W4 and W4r: the prompt set large, centred on the card, with the "again"
 * mark on a re-ask; empty while paused. The whole card flips.
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
      className="flex min-h-56 flex-col items-center justify-center text-center"
    >
      {hidden ? null : (
        <div ref={content} className="flex flex-col items-center gap-5">
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
      </p>
    );
  }
  return (
    <p className="flex justify-end">
      {fast ? (
        <span ref={mark} className="font-display text-figure-sm text-good-ink">
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
 * model answer, the alternates between hairlines, the key point. A ○ turns
 * the answer `good-ink`, a △ leaves it `ink`, a × fades it. Only this area
 * scrolls when it does not fit; it then takes focus, and ↑/↓ scroll it by
 * `data-part`.
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
  feedback?: { readonly grade: Grade; readonly fast: boolean };
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
          "-mx-2 -mb-2 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-2 pb-2",
          hidden && "invisible",
        )}
      >
        <p className="text-point text-muted-foreground">{card.prompt}</p>
        <p
          lang="en"
          className={cn(
            "font-latin text-answer transition-colors duration-160",
            feedback?.grade === "good" && "text-good-ink",
            feedback?.grade === "again" && "text-muted-foreground",
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
                className="border-b border-border py-3 font-latin text-alt text-muted-foreground"
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
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-b from-transparent to-card"
        />
      ) : null}
    </div>
  );
}
