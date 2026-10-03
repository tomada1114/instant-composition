import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactElement } from "react";
import { useTranslations } from "use-intl";
import { createAnswerQueue, sessionStore } from "../drill/answer-queue";
import { useQueuedDrill } from "../drill/answer-sync";
import { initVocab } from "./vocab-init";
import { currentCard } from "../drill/drill-state";
import { browserSound } from "../drill/sound";
import { Toast } from "../drill/toast";
import { useDrillClock, useDrillKeys, type DrillAction } from "../drill/use-drill";
import { useLeaveGuard } from "../drill/use-leave-guard";
import type { GradeKeyTrio, VocabSession, VocabSummary } from "../openapi";
import { VOCAB_QUERY } from "../lib/queries";
import { Button } from "../ui/button";
import { requestVocabFinish, VOCAB_QUEUE_PREFIX, sendVocabAnswer } from "./sessions";
import { VocabCard } from "./vocab-card";
import { VocabDialog } from "./vocab-dialog";
import { VocabDone } from "./vocab-done";

/** One untimed session uses the drill's reducer, grading keys, guarded navigation and durable queue. */
export function VocabStudy({
  session,
  sound,
  gradeKeys,
  onRestart,
}: Readonly<{
  session: VocabSession;
  sound: boolean;
  gradeKeys: GradeKeyTrio;
  onRestart: () => void;
}>): ReactElement {
  const t = useTranslations("Drill");
  const vocab = useTranslations("Vocab");
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [queue] = useState(() =>
    createAnswerQueue({
      key: `${VOCAB_QUEUE_PREFIX}${session.sessionId}`,
      send: sendVocabAnswer,
      storage: sessionStore(),
    }),
  );
  const [failures, setFailures] = useState(0);
  const [state, dispatch] = useQueuedDrill(
    queue,
    () => initVocab(session),
    () => {
      setFailures((count) => count + 1);
    },
  );
  const [summary, setSummary] = useState<VocabSummary>();
  const availability = useQuery({
    ...VOCAB_QUERY,
    queryKey: ["vocab", "after", session.sessionId],
    enabled: summary !== undefined,
  });
  const available = availability.data;
  const category = available?.categories.find(
    (row) => row.category === session.category,
  );
  const extraCount =
    session.category === null ? (available?.extra ?? 0) : (category?.extra ?? 0);
  const weakCount =
    session.category === null ? (available?.weak ?? 0) : (category?.weak ?? 0);
  const moreCount = session.kind === "weak" ? weakCount : extraCount;
  const [failed, setFailed] = useState(false);
  const [attempt, retry] = useState(0);
  const leave = useLeaveGuard(state, dispatch);
  useDrillClock(state, dispatch, false);
  const finishing = state.phase.kind === "finishing";
  useEffect(() => {
    if (!finishing) return undefined;
    let active = true;
    void requestVocabFinish(session.sessionId, queue.pending()).then((result) => {
      if (!active) return;
      if (result.ok) {
        queue.clear();
        setSummary(result.value);
        void cache.invalidateQueries({ queryKey: ["vocab"] });
      } else setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [finishing, session.sessionId, queue, cache, attempt]);
  function act(action: DrillAction, key: boolean): void {
    if (sound) browserSound.unlock();
    if (action.type === "scroll")
      document
        .querySelector("[data-part=back-scroll]")
        ?.scrollBy({ top: 48 * action.direction });
    else if (action.type === "grade")
      dispatch({ ...action, at: performance.now(), wall: Date.now(), key });
    else {
      if (action.type === "resume") leave.stay();
      dispatch({ type: action.type, at: performance.now() });
    }
  }
  useDrillKeys(state, gradeKeys, (action) => {
    act(action, true);
  });
  const phase = state.phase;
  useEffect(() => {
    if (sound && phase.kind === "feedback" && phase.grade !== "again")
      browserSound.play("ok");
  }, [sound, phase]);
  const shown = currentCard(state);
  const card = session.cards.find((value) => value.id === shown?.cardId);
  const announcement =
    phase.kind === "front" && card !== undefined ? (
      <>
        {`${shown?.pass === "retry" ? t("card.again") : ""} ${vocab("front")} `}
        <span lang="en">{card.definition}</span>
      </>
    ) : phase.kind === "feedback" ? (
      t(`grade.${phase.grade}`)
    ) : (
      ""
    );
  if (summary !== undefined)
    return (
      <VocabDone
        summary={summary}
        extraCount={moreCount}
        onExtra={() => {
          if (session.kind === "extra" || session.kind === "weak") {
            onRestart();
            return;
          }
          void navigate({
            to: "/vocab/study",
            search: {
              kind: "extra",
              ...(session.category === null ? {} : { category: session.category }),
            },
          });
        }}
      />
    );
  if (finishing)
    return failed ? (
      <div className="flex flex-col gap-4">
        <p>{t("save.unsaved", { count: Math.max(1, queue.pending().length) })}</p>
        <Button
          variant="secondary"
          onClick={() => {
            setFailed(false);
            retry((value) => value + 1);
          }}
        >
          {t("save.resend")}
        </Button>
      </div>
    ) : (
      <></>
    );
  const stay = (): void => {
    act({ type: "resume" }, false);
  };
  return (
    <>
      {card === undefined ? null : (
        <VocabCard
          state={state}
          card={card}
          gradeKeys={gradeKeys}
          onAction={(action) => {
            act(action, false);
          }}
        />
      )}
      {leave.asking || state.paused ? (
        <VocabDialog
          leaving={leave.asking}
          gradeKeys={gradeKeys}
          onStay={stay}
          onLeave={
            leave.asking
              ? leave.leave
              : () => {
                  void navigate({ to: "/vocab", ignoreBlocker: true });
                }
          }
        />
      ) : null}
      <Toast signal={failures} message={t("save.failed")} />
      <p aria-live="polite" className="sr-only">
        {state.paused ? "" : announcement}
      </p>
    </>
  );
}
