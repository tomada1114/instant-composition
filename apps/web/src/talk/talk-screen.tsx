import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { Ticks } from "../drill/top-strip";
import { FocusStrip } from "../lib/frame";
import { CloseGlyph } from "../ui/glyphs";
import { IconButton } from "../ui/icon-button";
import { Conversation } from "./conversation";
import { StepPanel } from "./step-panel";
import { currentTurn, keptTurns, TALK_TURNS, type Talk } from "./talk-state";
import type { TalkActions } from "./use-talk";

/**
 * The focus strip of a talk: ✕ (going home once the talk has ended), the six
 * ticks, and `n / 6`.
 */
function TalkStrip({
  talk,
  onClose,
}: Readonly<{ talk: Talk; onClose: () => void }>): ReactElement {
  const t = useTranslations("Talk.strip");
  const ended = talk.step === "ended";
  const turn = currentTurn(talk).n;
  const progress = (
    <Ticks
      current={ended ? keptTurns(talk) + 1 : turn}
      total={TALK_TURNS}
      lit={talk.step === "fine"}
    />
  );
  const counters = (
    <span className="font-latin text-count text-muted-foreground">
      {t("progress", { current: turn, total: TALK_TURNS })}
    </span>
  );
  if (ended) return <FocusStrip progress={progress} counters={counters} />;
  return (
    <FocusStrip
      close={
        <IconButton plain type="button" aria-label={t("close")} onClick={onClose}>
          <CloseGlyph />
        </IconButton>
      }
      progress={progress}
      counters={counters}
    />
  );
}

/**
 * W3, in the focus layout: the strip across the top, then the stage's
 * conversation, which alone scrolls, over the bottom panel.
 */
export function TalkScreen({
  talk,
  actions,
  onClose,
}: Readonly<{
  talk: Talk;
  actions: TalkActions;
  onClose: () => void;
}>): ReactElement {
  return (
    <div className="flex h-stage flex-col gap-3 pb-6">
      <TalkStrip talk={talk} onClose={onClose} />
      <Conversation talk={talk} />
      <div className="flex flex-col gap-3 border-t border-border pt-3 empty:hidden">
        <StepPanel step={talk.step} actions={actions} />
      </div>
    </div>
  );
}
