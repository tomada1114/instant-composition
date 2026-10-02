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
    <div className="grid grid-cols-2 gap-2.5">
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
 * W4 to W7: the focus strip, then the card, the timer under a front and the
 * actions, filling the stage top to bottom so the page itself never scrolls.
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
    <div className="mx-auto flex h-stage w-full max-w-reading flex-col gap-3 pt-3 pb-6">
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
      <Actions phase={phase} gradeKeys={gradeKeys} onAction={onAction} />
    </div>
  );
}
