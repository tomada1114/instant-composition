import { useEffect, useRef, useState, type Dispatch } from "react";
import type { VocabPagedState, VocabPagedEvent } from "./paged-state";
import { pagedVocabReducer } from "./paged-state";
import { saveVocabCheckpoint } from "./paged-checkpoint";
import type { PagedOutbox } from "./paged-outbox";

/** Durable append precedes checkpoint and feedback. Only one grade and one deferred control event are retained. */
export function usePagedStudy(
  queue: PagedOutbox,
  start: () => VocabPagedState,
  onFailure: () => void,
): readonly [VocabPagedState, Dispatch<VocabPagedEvent>] {
  const [state, setState] = useState(start);
  const latest = useRef(state);
  const failure = useRef(onFailure);
  useEffect(() => {
    failure.current = onFailure;
  });
  const [dispatch] = useState(() => {
    let busy = false;
    let pending: VocabPagedState | undefined;
    let deferred: VocabPagedEvent | undefined;
    function publish(next: VocabPagedState): boolean {
      pending = next;
      if (!saveVocabCheckpoint(next)) {
        failure.current();
        return false;
      }
      pending = undefined;
      latest.current = next;
      setState(next);
      return true;
    }
    function event(input: VocabPagedEvent): void {
      if (busy) {
        if (
          input.type !== "grade" &&
          (deferred === undefined || (input.type !== "tick" && input.type !== "shown"))
        )
          deferred = input;
        return;
      }
      if (input.type !== "grade" && pending === undefined) {
        const next = pagedVocabReducer(latest.current, input);
        if (next !== latest.current) publish(next);
        return;
      }
      busy = true;
      const commit = async (): Promise<void> => {
        const before = latest.current;
        const next = pending ?? pagedVocabReducer(before, input);
        if (next === before) return;
        // Retain the original grade even if page bytes save but metadata/checkpoint fails.
        pending = next;
        const added = next.answers.filter(
          (answer) => !before.answers.some((held) => held.id === answer.id),
        );
        for (const answer of added)
          if (!(await queue.append(answer))) {
            failure.current();
            return;
          }
        if (publish(next) && added.length > 0)
          void queue.flush().then((empty) => {
            if (!empty) failure.current();
          });
      };
      void commit()
        .catch(() => {
          failure.current();
        })
        .finally(() => {
          busy = false;
          const control = deferred;
          deferred = undefined;
          if (control !== undefined) event(control);
        });
    }
    return event;
  });
  useEffect(() => {
    void queue.flush().then((empty) => {
      if (!empty) failure.current();
    });
  }, [queue]);
  return [state, dispatch];
}
