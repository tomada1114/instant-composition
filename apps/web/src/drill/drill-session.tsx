import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import type { GradeKeys, RoundKind, RoundPayload } from "../openapi";
import { useAnswerQueue, useQueuedDrill, type ArrivedQueue } from "./answer-sync";
import { currentCard, initDrill, progress, type DrillState } from "./drill-state";
import { CardScreen } from "./card-screen";
import { DrillDone } from "./drill-done";
import { IntroScreen } from "./intro-screen";
import { PauseSheet } from "./pause-sheet";
import { ReadyScreen } from "./ready-screen";
import { browserSound } from "./sound";
import { Toast } from "./toast";
import {
  useDrillClock,
  useDrillKeys,
  useRoundFinish,
  type DrillAction,
} from "./use-drill";

/** Pixels one ↑/↓ press moves an overflowing back. */
const SCROLL_STEP = 48;

function startDrill({
  round,
  pressed,
  unsaved,
}: Readonly<
  { round: RoundPayload; pressed: boolean } & Pick<ArrivedQueue, "unsaved">
>): DrillState {
  const answered = [...round.answered, ...unsaved];
  return initDrill({
    roundId: round.id,
    deck: round.deck,
    limits: Object.fromEntries(
      Object.values(round.cards).map((card) => [card.id, card.limitMs]),
    ),
    paces: Object.fromEntries(
      Object.values(round.cards).map((card) => [card.id, card.paceMs]),
    ),
    answered,
    retries: round.retries,
    intro: !pressed || (round.kind === "placement" && answered.length === 0),
  });
}

/** What a screen reader hears as the drill moves: never the seconds ticking. */
function useAnnouncement(state: DrillState, round: RoundPayload): string {
  const t = useTranslations("Drill.announce");
  const card = currentCard(state);
  const content = card === undefined ? undefined : round.cards[card.cardId];
  const { phase } = state;
  if (content === undefined) return "";
  if (phase.kind === "feedback") return phase.result === "ok" ? t("said") : t("review");
  if (phase.kind === "back" && phase.mode === "timeout") return t("timeout");
  return t("front", { ja: content.prompt, seconds: content.limitMs / 1000 });
}

/** One round, from its first front to its summary, driven by the drill reducer. */
export function DrillSession({
  round,
  first,
  pressed,
  sound,
  gradeKeys,
  dailySize,
  onNext,
}: Readonly<{
  round: RoundPayload;
  first: boolean;
  pressed: boolean;
  sound: boolean;
  gradeKeys: GradeKeys;
  dailySize: number;
  onNext: (kind: RoundKind) => void;
}>): ReactElement {
  const t = useTranslations("Drill");
  const navigate = useNavigate();
  const goHome = (): void => {
    void navigate({ to: "/" });
  };
  const { queue, unsaved } = useAnswerQueue(round);
  const [failures, setFailures] = useState(0);
  const [state, dispatch] = useQueuedDrill(
    queue,
    () => startDrill({ round, pressed, unsaved }),
    () => {
      setFailures((count) => count + 1);
    },
  );
  const finish = useRoundFinish({
    roundId: round.id,
    finishing: state.phase.kind === "finishing",
    answers: [...unsaved, ...state.answers],
    onDone: () => {
      queue.clear();
      if (sound) browserSound.play("closing");
    },
  });
  const announcement = useAnnouncement(state, round);
  useDrillClock(state, dispatch);

  function act(action: DrillAction, key: boolean): void {
    const at = performance.now();
    const wall = Date.now();
    if (sound) browserSound.unlock();
    if (action.type === "scroll") {
      document
        .querySelector("[data-part=back-scroll]")
        ?.scrollBy({ top: SCROLL_STEP * action.direction });
    } else if (action.type === "grade") {
      dispatch({ type: "grade", result: action.result, at, wall, key });
    } else if (action.type === "flip") {
      dispatch({ type: "flip", at, wall });
    } else {
      dispatch({ type: action.type, at });
    }
  }
  useDrillKeys(state, gradeKeys, (action) => {
    act(action, true);
  });

  const { phase, combo } = state;
  useEffect(() => {
    if (!sound || phase.kind !== "feedback" || phase.result !== "ok") return;
    browserSound.play(combo >= 2 ? "combo" : phase.fast ? "okFast" : "ok");
  }, [sound, phase, combo]);

  if (
    phase.kind === "intro" &&
    (round.kind !== "placement" || round.answered.length + unsaved.length > 0)
  ) {
    return (
      <ReadyScreen
        kind={round.kind}
        count={round.total}
        where={progress(state)}
        offset={round.offset}
        onStart={() => {
          act({ type: "start" }, false);
        }}
      />
    );
  }
  if (phase.kind === "intro") {
    return (
      <IntroScreen
        first={first}
        count={round.deck.length}
        onStart={() => {
          act({ type: "start" }, false);
        }}
      />
    );
  }
  if (phase.kind === "finishing")
    // The round's own result is unsaved too, so a failed finish reports at least one record.
    return (
      <DrillDone
        finish={finish}
        unsaved={Math.max(1, queue.pending().length)}
        dailySize={dailySize}
        onNext={onNext}
        onEnd={goHome}
      />
    );

  const resumeAt =
    state.pass === "first"
      ? round.offset + state.firstDone + state.index + 1
      : round.offset + state.firstDone + state.queue.length + state.index + 1;
  return (
    <>
      <CardScreen
        state={state}
        round={round}
        gradeKeys={gradeKeys}
        onAction={(action) => {
          act(action, false);
        }}
      />
      {state.paused ? (
        <PauseSheet
          position={resumeAt}
          gradeKeys={gradeKeys}
          onQuit={goHome}
          onContinue={() => {
            act({ type: "resume" }, false);
          }}
        />
      ) : null}
      <Toast signal={failures} message={t("save.failed")} />
      <p aria-live="polite" className="sr-only">
        {state.paused ? "" : announcement}
      </p>
    </>
  );
}
