import { useTranslations } from "next-intl";
import { useEffect, useReducer, useState, type ReactElement } from "react";

import { drillReducer } from "../../core/drill-machine";
import { currentCard, initDrill, type DrillState } from "../../core/drill-state";
import type { RoundPayload } from "../../core/views";
import { useRouter } from "../../i18n/navigation";
import { CardScreen } from "./card-screen";
import { DrillDone } from "./drill-done";
import { IntroScreen } from "./intro-screen";
import { PauseSheet } from "./pause-sheet";
import { browserSound } from "./sound";
import { Toast } from "./toast";
import {
  useAnswerSync,
  useDrillClock,
  useDrillKeys,
  useRoundFinish,
  type DrillAction,
} from "./use-drill";

/** Pixels one ↑/↓ press moves an overflowing back. */
const SCROLL_STEP = 48;

function startDrill(round: RoundPayload): DrillState {
  return initDrill({
    roundId: round.id,
    deck: round.deck,
    limits: Object.fromEntries(
      Object.values(round.cards).map((card) => [card.id, card.limitMs]),
    ),
    answered: round.answered,
    retries: round.retries,
    intro: round.kind === "placement" && round.answered.length === 0,
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
  return t("front", { ja: content.ja, seconds: content.limitMs / 1000 });
}

/** One round, from its first front to its summary, driven by the drill reducer. */
export function DrillSession({
  round,
  first,
  sound,
}: Readonly<{ round: RoundPayload; first: boolean; sound: boolean }>): ReactElement {
  const t = useTranslations("Drill");
  const router = useRouter();
  const [state, dispatch] = useReducer(drillReducer, round, startDrill);
  const [failures, setFailures] = useState(0);
  const queue = useAnswerSync(round.id, state.answers, () => {
    setFailures((count) => count + 1);
  });
  const finish = useRoundFinish({
    roundId: round.id,
    finishing: state.phase.kind === "finishing",
    answers: state.answers,
    onDone: () => {
      queue.clear();
      if (sound) browserSound.play("closing");
    },
  });
  const announcement = useAnnouncement(state, round);
  useDrillClock(state, dispatch);

  function act(action: DrillAction, key: boolean): void {
    const at = performance.now();
    if (sound) browserSound.unlock();
    if (action.type === "scroll") {
      document
        .querySelector("[data-part=back-scroll]")
        ?.scrollBy({ top: SCROLL_STEP * action.direction });
    } else if (action.type === "grade") {
      dispatch({ type: "grade", result: action.result, at, key });
    } else {
      dispatch({ type: action.type, at });
    }
  }
  useDrillKeys(state, (action) => {
    act(action, true);
  });

  const { phase, combo } = state;
  useEffect(() => {
    if (!sound || phase.kind !== "feedback" || phase.result !== "ok") return;
    browserSound.play(combo >= 2 ? "combo" : phase.fast ? "okFast" : "ok");
  }, [sound, phase, combo]);

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
    return <DrillDone finish={finish} unsaved={Math.max(1, queue.pending().length)} />;

  const resumeAt =
    state.pass === "first"
      ? round.offset + state.firstDone + state.index + 1
      : round.offset + state.firstDone + state.queue.length + state.index + 1;
  return (
    <>
      <CardScreen
        state={state}
        round={round}
        onAction={(action) => {
          act(action, false);
        }}
      />
      {state.paused ? (
        <PauseSheet
          position={resumeAt}
          onQuit={() => {
            router.push("/");
          }}
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
