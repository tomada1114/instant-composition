import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { Ticks } from "../drill/top-strip";
import { CloseGlyph } from "../ui/glyphs";
import { IconButton } from "../ui/icon-button";
import { Conversation } from "./conversation";
import { StepPanel } from "./step-panel";
import { currentTurn, keptTurns, TALK_TURNS, type Talk } from "./talk-state";
import type { TalkActions } from "./use-talk";

/** The six ticks, and under them ✕ (gone once the talk has ended) and `n / 6`. */
function TalkStrip({
  talk,
  onClose,
}: Readonly<{ talk: Talk; onClose: () => void }>): ReactElement {
  const t = useTranslations("Talk.strip");
  const ended = talk.step === "ended";
  const turn = currentTurn(talk).n;
  return (
    <div className="flex flex-col gap-2">
      <Ticks
        current={ended ? keptTurns(talk) + 1 : turn}
        total={TALK_TURNS}
        lit={talk.step === "fine"}
      />
      <div className="grid h-11 grid-cols-[1fr_auto_1fr] items-center">
        {ended ? (
          <span />
        ) : (
          <IconButton
            plain
            type="button"
            aria-label={t("close")}
            onClick={onClose}
            className="justify-self-start"
          >
            <CloseGlyph />
          </IconButton>
        )}
        <span className="font-mono text-mono-sm text-muted-foreground">
          {t("progress", { current: turn, total: TALK_TURNS })}
        </span>
      </div>
    </div>
  );
}

/**
 * W3: the strip and the bottom panel fixed, the conversation scrolling
 * between them, the whole column above the tab bar so the page never scrolls.
 */
export function TalkScreen({
  talk,
  actions,
  onClose,
}: Readonly<{ talk: Talk; actions: TalkActions; onClose: () => void }>): ReactElement {
  return (
    <main className="mx-auto box-content flex h-[calc(var(--column-height)-var(--tab-bar-space)-1.5rem)] max-w-column flex-col gap-3 px-4 pt-3 pb-[calc(var(--tab-bar-space)+0.75rem)]">
      <TalkStrip talk={talk} onClose={onClose} />
      <Conversation talk={talk} />
      <div className="flex flex-col gap-3 border-t border-border pt-3 empty:hidden">
        <StepPanel step={talk.step} actions={actions} />
      </div>
    </main>
  );
}
