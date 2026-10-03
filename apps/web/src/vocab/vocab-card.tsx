import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { useTranslations } from "use-intl";
import { currentCard, progress, type DrillState } from "../drill/drill-state";
import { playMotion } from "../drill/motion";
import { TopStrip } from "../drill/top-strip";
import { KEY_OF } from "../lib/grade-keys";
import { cn } from "../lib/utils";
import type { GradeKeyTrio, VocabCard as Card } from "../openapi";
import type { DrillKeyAction } from "../drill/keys";
import { Button } from "../ui/button";
import { Eyebrow } from "../ui/eyebrow";
import { GradeTrio } from "../ui/grade-trio";
import { ReturnGlyph } from "../ui/glyphs";
import { VocabCardHeading } from "./vocab-card-heading";
import { Kbd } from "../ui/kbd";

/** Cloze marks are fixed-width blanks on the front and emphasized answers on the back. */
export function VocabExample({
  example,
  back,
}: Readonly<{ example: string; back: boolean }>): ReactElement {
  return (
    <p lang="en" className="font-latin whitespace-pre-line">
      {example.split(/(\{\{[^}]+\}\})/u).map((part, index) =>
        part.startsWith("{{") ? (
          back ? (
            <strong key={index} className="font-extrabold underline">
              {part.slice(2, -2)}
            </strong>
          ) : (
            <span
              key={index}
              aria-label="…"
              className="mx-1 inline-block w-[6ch] border-b-2 border-foreground"
            >
              &nbsp;
            </span>
          )
        ) : (
          part
        ),
      )}
    </p>
  );
}
/** V2: an untimed cloze or dialogue front and its full answer, with the shared grade trio. */
export function VocabCard({
  state,
  card,
  gradeKeys,
  onAction,
  onDelete,
}: Readonly<{
  state: DrillState;
  card: Card;
  gradeKeys: GradeKeyTrio;
  onDelete: () => void;
  onAction: (action: DrillKeyAction) => void;
}>): ReactElement {
  const drill = useTranslations("Drill");
  const front = state.phase.kind === "front";
  const reAsk = currentCard(state)?.pass === "retry";
  const where = progress(state);
  const face = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    function measure(): void {
      const element = face.current;
      setOverflowing(
        !front && element !== null && element.scrollHeight > element.clientHeight,
      );
    }
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
    };
  }, [front, card.id]);
  useEffect(() => {
    playMotion(face.current, front ? "fade" : "rise");
  }, [front, state.card]);
  const phase = state.phase;
  const feedback = phase.kind === "feedback" ? phase.grade : undefined;
  const interval = (days: number): string =>
    days === 1 ? drill("grade.tomorrow") : drill("grade.days", { count: days });
  return (
    <div className="flex max-h-[calc(100dvh-4rem)] w-full flex-col items-center gap-6 py-6">
      <TopStrip
        current={where.position}
        total={where.total}
        filled={
          where.position -
          (currentCard(state)?.pass === "first" && phase.kind !== "feedback" ? 1 : 0)
        }
        waiting={where.waiting}
        combo={0}
        onPause={() => {
          onAction({ type: "pause" });
        }}
      />
      <div
        ref={face}
        data-part="back-scroll"
        tabIndex={!front && overflowing ? 0 : undefined}
        className="flex min-h-0 w-full flex-col gap-5 overflow-y-auto rounded-panel border-2 border-border bg-card p-8"
      >
        {reAsk ? (
          <Eyebrow className="flex items-center gap-2">
            <ReturnGlyph />
            {drill("card.again")}
          </Eyebrow>
        ) : null}
        <VocabCardHeading
          card={card}
          removable={phase.kind === "back" && !state.paused}
          onDelete={onDelete}
        />
        {front ? (
          <button
            type="button"
            aria-label={drill("card.flip")}
            onClick={() => {
              onAction({ type: "flip" });
            }}
            className="flex flex-col gap-6 text-left hover:text-muted-foreground"
            style={{ visibility: state.paused ? "hidden" : "visible" }}
          >
            <p lang="en" className="font-latin">
              {card.definition}
            </p>
            <VocabExample example={card.example} back={false} />
          </button>
        ) : (
          <>
            <p
              lang="en"
              className={cn(
                "font-latin text-answer transition-colors duration-160",
                feedback === "good"
                  ? "text-good-ink"
                  : feedback === "again"
                    ? "text-muted-foreground"
                    : "text-foreground",
              )}
            >
              {card.headword}
            </p>
            <p className="text-heading">{card.meaning}</p>
            <hr className="border-border" />
            <VocabExample example={card.example} back />
            <p lang="en" className="font-latin text-muted-foreground">
              {card.example2}
            </p>
          </>
        )}
      </div>
      <div className="w-full max-w-progress shrink-0">
        {front ? (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              onAction({ type: "flip" });
            }}
          >
            {drill("card.flip")}
            <Kbd>Space</Kbd>
          </Button>
        ) : (
          <GradeTrio
            names={{
              again: drill("grade.again"),
              hard: drill("grade.hard"),
              good: drill("grade.good"),
            }}
            intervals={
              reAsk
                ? undefined
                : {
                    again: interval(card.intervals.again),
                    hard: interval(card.intervals.hard),
                    good: interval(card.intervals.good),
                  }
            }
            keys={{
              again: gradeKeys[KEY_OF.again],
              hard: gradeKeys[KEY_OF.hard],
              good: gradeKeys[KEY_OF.good],
            }}
            onGrade={(grade) => {
              onAction({ type: "grade", grade });
            }}
          />
        )}
      </div>
    </div>
  );
}
