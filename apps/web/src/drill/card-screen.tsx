import { useTranslations } from "use-intl";
import type { ReactElement } from "react";

import { keyLabel } from "../lib/grade-keys";
import { Button } from "../ui/button";
import { ArrowGlyph, CloseGlyph, RingGlyph } from "../ui/glyphs";
import { Kbd } from "../ui/kbd";

import {
  currentCard,
  progress,
  remainingMs,
  type DrillPhase,
  type DrillState,
} from "./drill-state";
import type { GradeKeys, RoundPayload } from "../openapi";
import { CardBack, CardFront } from "./flashcard";
import type { DrillKeyAction } from "./keys";
import { TimerBar } from "./timer-bar";
import { TopStrip } from "./top-strip";

type OnAction = (action: DrillKeyAction) => void;

/** A grade's key hint; a "←" sits at the start edge, so it points the way it is pressed. */
function GradeKbd({ code }: Readonly<{ code: string }>): ReactElement {
  return <Kbd side={code === "ArrowLeft" ? "start" : "end"}>{keyLabel(code)}</Kbd>;
}

function Actions({
  phase,
  gradeKeys,
  onAction,
}: Readonly<{
  phase: DrillPhase;
  gradeKeys: GradeKeys;
  onAction: OnAction;
}>): ReactElement {
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
    <div className="grid grid-cols-2 gap-3">
      <Button
        variant="secondary"
        onClick={() => {
          onAction({ type: "grade", result: "ng" });
        }}
      >
        <CloseGlyph className="size-4.5" />
        {t("notSaid")}
        <GradeKbd code={gradeKeys.ng} />
      </Button>
      <Button
        variant="good"
        onClick={() => {
          onAction({ type: "grade", result: "ok" });
        }}
      >
        <RingGlyph className="size-4.5" />
        {t("said")}
        <GradeKbd code={gradeKeys.ok} />
      </Button>
    </div>
  );
}

/**
 * W4 to W7: the focus strip, then the face on a card, with the timer under a
 * front and the actions under either, at most 560 wide — the group centred
 * on the stage, never pinned to the window's bottom edge. The group is held
 * to the stage's height, so a back too tall for it scrolls inside the card
 * and the page itself never does.
 */
export function CardScreen({
  state,
  round,
  gradeKeys,
  onAction,
}: Readonly<{
  state: DrillState;
  round: RoundPayload;
  gradeKeys: GradeKeys;
  onAction: OnAction;
}>): ReactElement | null {
  const card = currentCard(state);
  const content = card === undefined ? undefined : round.cards[card.cardId];
  if (card === undefined || content === undefined) return null;

  const { phase } = state;
  const where = progress(state);
  const first = where.pass === "first";
  return (
    <div className="flex max-h-[calc(100dvh-4rem)] w-full flex-col items-center gap-6 py-6">
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
      <div className="flex min-h-0 w-full flex-col rounded-panel border-2 border-border bg-card p-8">
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
      </div>
      <div className="flex w-full max-w-progress shrink-0 flex-col gap-4">
        {phase.kind === "front" ? (
          <TimerBar
            remainingMs={remainingMs(state) ?? content.limitMs}
            limitMs={content.limitMs}
          />
        ) : null}
        <Actions phase={phase} gradeKeys={gradeKeys} onAction={onAction} />
      </div>
    </div>
  );
}
