import { useTranslations } from "next-intl";
import { useEffect, useRef, type ReactElement } from "react";

import { Chip } from "@/components/ui/chip";
import { CloseGlyph } from "@/components/ui/glyphs";

import type { Pass } from "../../core/types";
import { playMotion } from "./motion";

/** Pause at the left, the progress in the middle, the combo at the right from 2. */
export function TopStrip({
  pass,
  current,
  total,
  combo,
  onPause,
}: Readonly<{
  pass: Pass;
  current: number;
  total: number;
  combo: number;
  onPause: () => void;
}>): ReactElement {
  const t = useTranslations("Drill.card");
  const comboRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (combo >= 2) playMotion(comboRef.current, "pulse");
  }, [combo]);

  return (
    <div className="grid h-11 grid-cols-[1fr_auto_1fr] items-center">
      <button
        type="button"
        onClick={onPause}
        className="group inline-flex h-11 items-center gap-1 justify-self-start text-label text-muted-foreground"
      >
        <span className="flex size-11 items-center justify-center rounded-full text-foreground group-active:bg-raised">
          <CloseGlyph />
        </span>
        {t("pause")}
        <Chip variant="kbd" className="ml-1">
          Esc
        </Chip>
      </button>
      <span className="font-mono text-mono-sm">
        {pass === "first"
          ? t("progress", { current, total })
          : t("retryProgress", { current, total })}
      </span>
      <span className="justify-self-end text-accent">
        {combo >= 2 ? (
          <span ref={comboRef} data-part="combo" className="inline-block text-label">
            <span className="font-latin text-number-md">{combo}</span>
            <span className="ml-1.5">{t("comboLabel")}</span>
          </span>
        ) : null}
      </span>
    </div>
  );
}
