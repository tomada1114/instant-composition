import { useRef, useState } from "react";

import type { SettingsPatch } from "../../core/api";
import type { Settings, SubtopicRef } from "../../core/types";
import { saveSettings } from "@/components/lib/api";

export interface SettingsState {
  readonly settings: Settings;
  /** The last save failed and the screen shows what was saved before it. */
  readonly failed: boolean;
  readonly removedFocus: readonly SubtopicRef[];
  readonly completedToday: boolean;
  save(patch: SettingsPatch): void;
}

/**
 * Saves each change as it is made. The screen shows the change at once; only
 * the latest save's answer settles it, and a failure puts back what was last
 * saved.
 */
export function useSettings(initial: Settings): SettingsState {
  const [settings, setSettings] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [removedFocus, setRemovedFocus] = useState<readonly SubtopicRef[]>([]);
  const [completedToday, setCompletedToday] = useState(false);
  const saved = useRef(initial);
  const latest = useRef(0);

  function save(patch: SettingsPatch): void {
    const request = ++latest.current;
    setSettings((current) => ({ ...current, ...patch }) as Settings);
    setFailed(false);
    void saveSettings(patch).then((result) => {
      if (result.ok) saved.current = result.value.settings;
      if (request !== latest.current) return;
      if (!result.ok) {
        setSettings(saved.current);
        setFailed(true);
        return;
      }
      setSettings(result.value.settings);
      setRemovedFocus(result.value.removedFocus);
      if (result.value.completedToday) setCompletedToday(true);
    });
  }

  return { settings, failed, removedFocus, completedToday, save };
}
