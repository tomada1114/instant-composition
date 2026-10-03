import type { ReactElement } from "react";
import { useTranslations } from "use-intl";
import { currentCard, type DrillState } from "../drill/drill-state";
import type { VocabCard } from "../openapi";

/** English alone carries its language in the live Japanese announcement. */
export function VocabAnnouncement({
  state,
  card,
}: Readonly<{ state: DrillState; card: VocabCard | undefined }>): ReactElement {
  const drill = useTranslations("Drill");
  const vocab = useTranslations("Vocab");
  const phase = state.phase;
  return (
    <p aria-live="polite" className="sr-only">
      {state.paused ? (
        ""
      ) : phase.kind === "front" && card !== undefined ? (
        <>
          {`${currentCard(state)?.pass === "retry" ? drill("card.again") : ""} ${vocab("front")} `}
          <span lang="en">{card.definition}</span>
        </>
      ) : phase.kind === "feedback" ? (
        drill(`grade.${phase.grade}`)
      ) : (
        ""
      )}
    </p>
  );
}
