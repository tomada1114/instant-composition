import { useEffect, useRef, useState, type Dispatch } from "react";
import type { AnswerQueue } from "./answer-queue";
import type { StudyEvent, StudyState } from "./study-state";

/**
 * The study state, moved by the activity's reducer, with each answer an event adds
 * put in `queue` by the same call that dispatched it: stored before React
 * renders or runs an effect, so a reload right after a grade still finds it.
 * What the queue held on arrival is sent on mount; `onFailure` hears of each
 * answer that fails to save.
 */
export function useQueuedStudy<S extends StudyState>(
  queue: AnswerQueue,
  start: () => S,
  onFailure: () => void,
  reducer: (state: S, event: StudyEvent) => S,
): readonly [S, Dispatch<StudyEvent>] {
  const [state, setState] = useState(start);
  // Every event passes through `dispatch`, so this is always the state React will hold next.
  const latest = useRef(state);
  const report = useRef(onFailure);
  useEffect(() => {
    report.current = onFailure;
  });

  const [dispatch] = useState(() => {
    const deliver = (delivered: Promise<boolean>): void => {
      void delivered.then((done) => {
        if (!done) report.current();
      });
    };
    return {
      deliver,
      event: (event: StudyEvent): void => {
        const before = latest.current;
        const next = reducer(before, event);
        if (next === before) return;
        latest.current = next;
        for (const answer of next.answers.slice(before.answers.length)) {
          deliver(queue.enqueue(answer));
        }
        setState(next);
      },
    };
  });

  useEffect(() => {
    dispatch.deliver(queue.flush());
  }, [dispatch, queue]);

  return [state, dispatch.event];
}
