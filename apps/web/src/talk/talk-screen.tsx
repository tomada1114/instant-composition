import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { FocusStrip } from "../lib/frame";
import { cn } from "../lib/utils";
import { CloseGlyph } from "../ui/glyphs";
import { IconButton } from "../ui/icon-button";
import { Conversation } from "./conversation";
import { StepPanel } from "./step-panel";
import { currentTurn, keptTurns, TALK_TURNS, type Talk } from "./talk-state";
import type { TalkActions } from "./use-talk";

/**
 * `designing-ui`'s `talk` progress: six 8-tall pills 4 apart, the done turns
 * `bg-good`, the rest `bg-bar-track`.
 */
function TurnPills({ done }: Readonly<{ done: number }>): ReactElement {
  return (
    <div aria-hidden className="flex w-full max-w-reading gap-1">
      {Array.from({ length: TALK_TURNS }, (_, index) => (
        <span
          key={index}
          data-done={index < done ? "" : undefined}
          className={cn(
            "h-2 flex-1 rounded-full transition-colors duration-160",
            index < done ? "bg-good" : "bg-bar-track",
          )}
        />
      ))}
    </div>
  );
}

/**
 * The focus strip of a talk: ✕ (going home once the talk has ended), the six
 * turns' pills, and `n / 6`.
 */
function TalkStrip({
  talk,
  onClose,
}: Readonly<{ talk: Talk; onClose: () => void }>): ReactElement {
  const t = useTranslations("Talk.strip");
  const ended = talk.step === "ended";
  const turn = currentTurn(talk).n;
  const progress = <TurnPills done={ended ? keptTurns(talk) : turn - 1} />;
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
 * W3, in the focus layout: the strip across the top, then a column max 720
 * centred on the stage — the conversation, which alone scrolls, over the step
 * panel on its foot.
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
    <>
      <TalkStrip talk={talk} onClose={onClose} />
      <div className="mx-auto flex h-stage w-full max-w-reading flex-col gap-4 pb-6">
        <Conversation talk={talk} />
        <div
          data-part="step-panel"
          className="flex flex-col gap-3 rounded-panel border-2 border-border bg-card p-5 empty:hidden"
        >
          <StepPanel step={talk.step} actions={actions} />
        </div>
      </div>
    </>
  );
}
