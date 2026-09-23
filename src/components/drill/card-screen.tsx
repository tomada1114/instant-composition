import { useTranslations } from "next-intl";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { ArrowGlyph, CloseGlyph, RingGlyph } from "@/components/ui/glyphs";
import { Kbd } from "@/components/ui/kbd";

import {
  currentCard,
  progress,
  remainingMs,
  type DrillPhase,
  type DrillState,
} from "../../core/drill-state";
import type { RoundPayload } from "../../core/views";
import { CardBack, CardFront } from "./flashcard";
import type { DrillKeyAction } from "./keys";
import { TimerBar } from "./timer-bar";
import { TopStrip } from "./top-strip";

type OnAction = (action: DrillKeyAction) => void;

function Actions({
  phase,
  onAction,
}: Readonly<{ phase: DrillPhase; onAction: OnAction }>): ReactElement {
  const t = useTranslations("Drill.card");
  if (phase.kind === "front") {
    return (
      <Button
        variant="secondary"
        className="w-full"
        onClick={() => {
          onAction({ type: "flip" });
        }}
      >
        {t("flip")}
        <Kbd>Space</Kbd>
      </Button>
    );
  }
  if (phase.kind === "back" && phase.mode === "timeout") {
    return (
      <Button
        className="w-full"
        onClick={() => {
          onAction({ type: "next" });
        }}
      >
        {t("next")}
        <ArrowGlyph className="size-4.5" />
        <Kbd>Space</Kbd>
      </Button>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Button
        variant="secondary"
        onClick={() => {
          onAction({ type: "grade", result: "ng" });
        }}
      >
        <CloseGlyph className="size-4.5" />
        {t("notSaid")}
        <Kbd side="start">←</Kbd>
      </Button>
      <Button
        onClick={() => {
          onAction({ type: "grade", result: "ok" });
        }}
      >
        <RingGlyph className="size-4.5" />
        {t("said")}
        <Kbd>→</Kbd>
      </Button>
    </div>
  );
}

/**
 * W4 to W7: the ticks and top strip, the card, the timer under a front and
 * the actions, fixed top to bottom so the page itself never scrolls.
 */
export function CardScreen({
  state,
  round,
  onAction,
}: Readonly<{
  state: DrillState;
  round: RoundPayload;
  onAction: OnAction;
}>): ReactElement | null {
  const card = currentCard(state);
  const content = card === undefined ? undefined : round.cards[card.cardId];
  if (card === undefined || content === undefined) return null;

  const { phase } = state;
  const where = progress(state);
  const first = where.pass === "first";
  return (
    <main className="mx-auto box-content flex h-[calc(100dvh-1.5rem)] max-w-column flex-col gap-3 px-4 pt-3 pb-3">
      <TopStrip
        pass={where.pass}
        current={first ? round.offset + where.position : where.position}
        total={first ? round.total : where.total}
        combo={state.combo}
        lit={phase.kind === "feedback" && phase.result === "ok"}
        onPause={() => {
          onAction({ type: "pause" });
        }}
      />
      {phase.kind === "front" ? (
        <CardFront
          card={content}
          retry={card.pass === "retry"}
          hidden={state.paused}
          onFlip={() => {
            onAction({ type: "flip" });
          }}
        />
      ) : phase.kind === "back" ? (
        <CardBack card={content} mode={phase.mode} elapsedMs={phase.elapsedMs} />
      ) : phase.kind === "feedback" ? (
        <CardBack
          card={content}
          mode="self"
          elapsedMs={phase.elapsedMs}
          feedback={phase}
        />
      ) : null}
      <div className="h-7">
        {phase.kind === "front" ? (
          <TimerBar
            remainingMs={remainingMs(state) ?? content.limitMs}
            limitMs={content.limitMs}
          />
        ) : null}
      </div>
      <Actions phase={phase} onAction={onAction} />
    </main>
  );
}
