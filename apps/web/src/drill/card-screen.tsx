import { useTranslations } from "use-intl";
import type { ReactElement } from "react";

import { GRADES, KEY_OF } from "../lib/grade-keys";
import type { DrillCard, Grade, GradeKeyTrio, RoundPayload } from "../openapi";
import { Button } from "../ui/button";
import { GradeTrio } from "../ui/grade-trio";
import { Kbd } from "../ui/kbd";

import {
  currentCard,
  progress,
  remainingMs,
  type DrillPhase,
  type DrillState,
} from "./drill-state";
import { CardBack, CardFront } from "./flashcard";
import type { StudyKeyAction as DrillKeyAction } from "../study/keys";
import { TimerBar } from "./timer-bar";
import { TopStrip } from "../study/top-strip";

type OnAction = (action: DrillKeyAction) => void;

function byGrade<T>(value: (grade: Grade) => T): Record<Grade, T> {
  return Object.fromEntries(GRADES.map((grade) => [grade, value(grade)])) as Record<
    Grade,
    T
  >;
}

/** The flip button under a front, or the grade trio under either back. */
function Actions({
  phase,
  card,
  reAsk,
  gradeKeys,
  onAction,
}: Readonly<{
  phase: DrillPhase;
  card: DrillCard;
  reAsk: boolean;
  gradeKeys: GradeKeyTrio;
  onAction: OnAction;
}>): ReactElement {
  const t = useTranslations("Drill");
  if (phase.kind === "front") {
    return (
      <Button
        variant="secondary"
        className="w-full"
        onClick={() => {
          onAction({ type: "flip" });
        }}
      >
        {t("card.flip")}
        <Kbd>Space</Kbd>
      </Button>
    );
  }
  const days = (count: number): string =>
    count === 1 ? t("grade.tomorrow") : t("grade.days", { count });
  return (
    <GradeTrio
      names={byGrade((grade) => t(`grade.${grade}`))}
      intervals={reAsk ? undefined : byGrade((grade) => days(card.intervals[grade]))}
      keys={byGrade((grade) => gradeKeys[KEY_OF[grade]])}
      onGrade={(grade) => {
        onAction({ type: "grade", grade });
      }}
    />
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
  gradeKeys: GradeKeyTrio;
  onAction: OnAction;
}>): ReactElement | null {
  const card = currentCard(state);
  const content = card === undefined ? undefined : round.cards[card.cardId];
  if (card === undefined || content === undefined) return null;

  const { phase } = state;
  const where = progress(state);
  const current = round.offset + where.position;
  // A first pass fills its share of the bar the moment it is graded, whatever the grade.
  const ungraded = card.pass === "first" && phase.kind !== "feedback";
  const reAsk = card.pass === "retry";
  return (
    <div className="flex max-h-[calc(100dvh-4rem)] w-full flex-col items-center gap-6 py-6">
      <TopStrip
        current={current}
        total={round.total}
        filled={current - (ungraded ? 1 : 0)}
        waiting={where.waiting}
        combo={state.combo}
        onPause={() => {
          onAction({ type: "pause" });
        }}
      />
      <div className="flex min-h-0 w-full flex-col rounded-panel border-2 border-border bg-card p-8">
        {phase.kind === "front" ? (
          <CardFront
            key={`${card.cardId}:${String(card.ask)}`}
            card={content}
            retry={reAsk}
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
            mode={phase.mode}
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
        <Actions
          phase={phase}
          card={content}
          reAsk={reAsk}
          gradeKeys={gradeKeys}
          onAction={onAction}
        />
      </div>
    </div>
  );
}
