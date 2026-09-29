import { useRef, useState } from "react";

import { updateLevel } from "../lib/endpoints";
import type { LevelChoice, LevelView, SettingsPageView } from "../openapi";

export interface LevelState {
  readonly view: LevelView;
  /** The last change failed and the screen shows the level as it was before it. */
  readonly failed: boolean;
  choose(choice: LevelChoice): void;
}

/**
 * Saves each change of level or mode as it is made: shown at once, and put
 * back on a failure to what the newest successful change saved. Answers may
 * arrive out of order, so an older success never overwrites a newer one.
 */
export function useLevel(
  initial: LevelView,
  levels: SettingsPageView["levels"],
): LevelState {
  const [view, setView] = useState(initial);
  const [failed, setFailed] = useState(false);
  const saved = useRef(initial);
  const latest = useRef(0);
  /** The newest request whose success `saved` holds; 0 for the level as read. */
  const settled = useRef(0);
  /** The newest request failed, so the view shows `saved` rather than a pending change. */
  const latestFailed = useRef(false);

  function choose(choice: LevelChoice): void {
    const request = ++latest.current;
    setView((current) => {
      if (choice.mode === "auto") return { ...current, mode: "auto" };
      const toeic = levels.find((option) => option.level === choice.level)?.toeic;
      return { mode: "manual", level: choice.level, toeic: toeic ?? current.toeic };
    });
    setFailed(false);
    latestFailed.current = false;
    void updateLevel(choice).then((result) => {
      if (result.ok) {
        if (request <= settled.current) return;
        settled.current = request;
        saved.current = result.value;
        if (request === latest.current || latestFailed.current) setView(result.value);
        return;
      }
      if (request !== latest.current) return;
      latestFailed.current = true;
      setView(saved.current);
      setFailed(true);
    });
  }

  return { view, failed, choose };
}
