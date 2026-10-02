import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import type { GradeKeys, RoundKind, RoundPayload } from "../openapi";
import { useAnswerQueue, useQueuedDrill, type ArrivedQueue } from "./answer-sync";
import { initDrill } from "./drill-init";
import { progress, type DrillState } from "./drill-state";
import { CardScreen } from "./card-screen";
import { DrillDone } from "./drill-done";
import { IntroScreen } from "./intro-screen";
import { LeaveSheet } from "./leave-sheet";
import { PauseSheet } from "./pause-sheet";
import { ReadyScreen } from "./ready-screen";
import { browserSound, roundSound } from "./sound";
import { Toast } from "./toast";
import { useAnnouncement } from "./use-announcement";
import {
  useDrillClock,
  useDrillKeys,
  useRoundFinish,
  type DrillAction,
} from "./use-drill";
import { useLeaveGuard } from "./use-leave-guard";

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
    void navigate({ to: "/", ignoreBlocker: true });
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
    onDone: (summary) => {
      queue.clear();
      if (sound) browserSound.play(roundSound(summary));
    },
  });
  const announcement = useAnnouncement(state, round);
  useDrillClock(state, dispatch);
  const leave = useLeaveGuard(state, dispatch);

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
      if (action.type === "resume") leave.stay();
      dispatch({ type: action.type, at });
    }
  }
  useDrillKeys(state, gradeKeys, (action) => {
    act(action, true);
  });
  const resume = (): void => {
    act({ type: "resume" }, false);
  };

  const { phase, combo } = state;
  useEffect(() => {
    if (!sound || phase.kind !== "feedback" || phase.result !== "ok") return;
    browserSound.play(combo >= 2 ? "combo" : phase.fast ? "okFast" : "ok");
  }, [sound, phase, combo]);

  if (phase.kind === "intro") {
    const start = (): void => {
      act({ type: "start" }, false);
    };
    return round.kind !== "placement" || round.answered.length + unsaved.length > 0 ? (
      <ReadyScreen
        kind={round.kind}
        count={round.total}
        where={progress(state)}
        offset={round.offset}
        onStart={start}
      />
    ) : (
      <IntroScreen first={first} round={round} onStart={start} />
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

  const behind = state.pass === "first" ? 0 : state.queue.length;
  const resumeAt = round.offset + state.firstDone + behind + state.index + 1;
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
      {leave.asking ? (
        <LeaveSheet position={resumeAt} onLeave={leave.leave} onStay={resume} />
      ) : state.paused ? (
        <PauseSheet
          position={resumeAt}
          gradeKeys={gradeKeys}
          onQuit={goHome}
          onContinue={resume}
        />
      ) : null}
      <Toast signal={failures} message={t("save.failed")} />
      <p aria-live="polite" className="sr-only">
        {state.paused ? "" : announcement}
      </p>
    </>
  );
}
