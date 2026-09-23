import { useTranslations } from "next-intl";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { cn } from "@/components/lib/utils";
import { Chip } from "@/components/ui/chip";

import type { DrillCard } from "../../core/views";
import { playMotion } from "./motion";

/** Past this many characters a prompt runs to a third line at `front`, so it drops to `front-long`. */
const FRONT_LONG_AFTER = 31;

function CardFrame({
  glow = false,
  onClick,
  children,
}: Readonly<{
  glow?: boolean;
  onClick?: () => void;
  children: ReactNode;
}>): ReactElement {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex min-h-70 flex-1 flex-col overflow-hidden rounded-card bg-card p-6 transition-shadow duration-120",
        glow &&
          "shadow-glow motion-reduce:shadow-none motion-reduce:ring-2 motion-reduce:ring-accent",
      )}
    >
      {children}
    </div>
  );
}

/** W4 and W4r: the prompt, with the "again" mark on a retry; empty while paused. */
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
    <CardFrame {...(onFlip === undefined ? {} : { onClick: onFlip })}>
      {hidden ? null : (
        <div ref={content} className="flex flex-col items-start gap-4">
          {retry ? <Chip variant="again">{t("again")}</Chip> : null}
          <p
            className={
              card.ja.length > FRONT_LONG_AFTER ? "text-front-long" : "text-front"
            }
          >
            {card.ja}
          </p>
        </div>
      )}
    </CardFrame>
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
  const chip = useRef<HTMLSpanElement>(null);
  const seconds = Math.round(elapsedMs / 100) / 10;

  useEffect(() => {
    if (fast) playMotion(chip.current, "chip");
  }, [fast]);

  if (mode === "timeout") {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-label">{t("timedOut")}</span>
        <Chip variant="review">{t("review")}</Chip>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-end">
      {fast ? (
        <Chip ref={chip} variant="speed">
          {t("fast", { seconds })}
        </Chip>
      ) : (
        <span className="font-mono text-mono-md">{t("seconds", { seconds })}</span>
      )}
    </div>
  );
}

/**
 * W5, W6 and W7: the answer to read. Only the card scrolls when it does not
 * fit; the area then takes focus, and ↑/↓ scroll it by `data-part`.
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
    <CardFrame glow={feedback?.result === "ok"}>
      <div
        ref={area}
        data-part="back-scroll"
        tabIndex={overflowing ? 0 : undefined}
        className={cn(
          "-m-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-2",
          hidden && "invisible",
        )}
      >
        <p className="truncate text-muted-foreground">{card.ja}</p>
        <p
          lang="en"
          className={cn(
            "font-latin text-answer transition-colors duration-160",
            feedback?.result === "ng" && "text-muted-foreground",
          )}
        >
          {card.en}
        </p>
        {card.alternatives.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-tile bg-raised p-4">
            {card.alternatives.map((alternative) => (
              <p key={alternative} lang="en" className="font-latin text-alt">
                {alternative}
              </p>
            ))}
          </div>
        ) : null}
        <p className="text-point text-muted-foreground">
          <span className="mr-2 text-label">{t("point")}</span>
          {card.point}
        </p>
        <div className="mt-auto">
          <BackFooter
            mode={mode}
            elapsedMs={elapsedMs}
            fast={feedback?.fast ?? false}
          />
        </div>
        {overflowing ? (
          <div
            aria-hidden
            className="pointer-events-none sticky bottom-0 -mt-10 h-6 shrink-0 bg-linear-to-b from-transparent to-card"
          />
        ) : null}
      </div>
    </CardFrame>
  );
}
