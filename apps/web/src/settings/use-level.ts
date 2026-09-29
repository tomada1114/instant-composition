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
 * Saves each change of level or mode as it is made, the way `useSettings`
 * does: shown at once, settled by the latest answer, put back on a failure.
 */
export function useLevel(
  initial: LevelView,
  levels: SettingsPageView["levels"],
): LevelState {
  const [view, setView] = useState(initial);
  const [failed, setFailed] = useState(false);
  const saved = useRef(initial);
  const latest = useRef(0);

  function choose(choice: LevelChoice): void {
    const request = ++latest.current;
    setView((current) => {
      if (choice.mode === "auto") return { ...current, mode: "auto" };
      const toeic = levels.find((option) => option.level === choice.level)?.toeic;
      return { mode: "manual", level: choice.level, toeic: toeic ?? current.toeic };
    });
    setFailed(false);
    void updateLevel(choice).then((result) => {
      if (result.ok) saved.current = result.value;
      if (request !== latest.current) return;
      if (!result.ok) {
        setView(saved.current);
        setFailed(true);
        return;
      }
      setView(result.value);
    });
  }

  return { view, failed, choose };
}
