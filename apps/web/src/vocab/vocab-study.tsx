import { restorePagedVocab } from "./paged-restore";
import { VocabWaiting } from "./vocab-waiting";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactElement } from "react";
import { useTranslations } from "use-intl";
import { browserVocabOutbox } from "./browser-outbox";
import { usePagedStudy } from "./use-paged-study";
import { useVocabContinuation } from "./use-vocab-continuation";
import { useVocabFinish } from "./use-vocab-finish";
import { currentCard } from "../study/study-state";
import { browserSound } from "../study/sound";
import { Toast } from "../study/toast";
import { useStudyClock, useStudyKeys, type StudyAction } from "../study/use-study";
import { useLeaveGuard } from "../study/use-leave-guard";
import type { AnswerInput } from "../study/study-state";
import type { GradeKeyTrio, VocabPage } from "../openapi";
import { VocabCard } from "./vocab-card";
import { VocabDialog } from "./vocab-dialog";
import { useVocabDelete } from "./use-vocab-delete";
import { VocabDeleteDialog } from "./vocab-delete-dialog";
import { VocabAnnouncement } from "./vocab-announcement";
import { useVocabAvailability } from "./use-vocab-availability";
import { VocabDone } from "./vocab-done";

/** One vocabulary session uses the shared study reducer, grading keys, guarded navigation and durable queue. */
export function VocabStudy({
  session,
  sound,
  gradeKeys,
  onRestart,
  pending,
}: Readonly<{
  session: VocabPage;
  sound: boolean;
  gradeKeys: GradeKeyTrio;
  onRestart: () => void;
  pending: readonly AnswerInput[];
}>): ReactElement {
  const t = useTranslations("Drill");
  const vocab = useTranslations("Vocab");
  const navigate = useNavigate();
  const [queue] = useState(() =>
    browserVocabOutbox(session.sessionId, session.generation),
  );
  const [failures, setFailures] = useState(0);
  const [state, dispatch] = usePagedStudy(
    queue,
    () => restorePagedVocab(session, pending),
    () => {
      setFailures((count) => count + 1);
    },
  );
  const leave = useLeaveGuard(state, dispatch);
  const deletion = useVocabDelete(state, dispatch, queue, () => {
    leave.stay();
    dispatch({ type: "resume", at: performance.now() });
  });
  useStudyClock(state, dispatch);
  const continuation = useVocabContinuation(state, dispatch);
  const finishing = state.phase.kind === "finishing" && !continuation.waiting;
  const { summary, failed, retry } = useVocabFinish(session, queue, finishing);
  const moreCount = useVocabAvailability(session, summary !== undefined);
  function act(action: StudyAction, key: boolean): void {
    if (deletion.asking) {
      if (action.type === "resume") deletion.keep();
      return;
    }
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
  useStudyKeys(
    deletion.asking ? { ...state, paused: true } : state,
    gradeKeys,
    (action) => {
      act(action, true);
    },
  );
  const phase = state.phase;
  useEffect(() => {
    if (sound && phase.kind === "feedback" && phase.grade !== "again")
      browserSound.play("ok");
  }, [sound, phase]);
  const shown = currentCard(state);
  const card = shown === undefined ? undefined : state.cards[shown.cardId]?.card;
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
  if (continuation.waiting)
    return (
      <VocabWaiting
        failed={continuation.failed || failures > 0}
        onRetry={continuation.retry}
      />
    );
  if (finishing)
    return (
      <VocabWaiting
        failed={failed}
        pending={Math.max(1, queue.count())}
        onRetry={retry}
      />
    );
  const stay = (): void => {
    act({ type: "resume" }, false);
  };
  return (
    <>
      {card === undefined ? null : (
        <div inert={deletion.asking || undefined}>
          <VocabCard
            state={state}
            card={card}
            gradeKeys={gradeKeys}
            onDelete={deletion.ask}
            onAction={(action) => {
              act(action, false);
            }}
          />
        </div>
      )}
      {deletion.asking ? (
        <VocabDeleteDialog
          pending={deletion.pending}
          onDelete={deletion.confirm}
          onKeep={deletion.keep}
        />
      ) : leave.asking || state.paused ? (
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
      <Toast signal={deletion.failures} message={vocab("delete.failed")} />
      <Toast signal={failures} message={t("save.failed")} />
      <VocabAnnouncement
        state={deletion.asking ? { ...state, paused: true } : state}
        card={card}
      />
    </>
  );
}
