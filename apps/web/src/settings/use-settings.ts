import { useRef, useState } from "react";

import { updateSettings } from "../lib/endpoints";
import type { Settings, SettingsPatch, SubtopicRef } from "../openapi";

export interface SettingsState {
  readonly settings: Settings;
  /** The last save failed and the screen shows what was saved before it. */
  readonly failed: boolean;
  readonly removedFocus: readonly SubtopicRef[];
  readonly completedToday: boolean;
  save(patch: SettingsPatch): void;
}

/**
 * Saves each change as it is made. The screen shows the last settings the
 * server answered with, and every save still in flight laid over them in the
 * order they were made, so a failed save takes back only its own fields and
 * never a change made after it.
 */
export function useSettings(initial: Settings): SettingsState {
  const [settings, setSettings] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [removedFocus, setRemovedFocus] = useState<readonly SubtopicRef[]>([]);
  const [completedToday, setCompletedToday] = useState(false);
  const saved = useRef(initial);
  // An answer older than one already applied would put back a stale server view.
  const savedRequest = useRef(0);
  const pending = useRef(new Map<number, SettingsPatch>());
  const latest = useRef(0);

  function show(): void {
    let next = saved.current;
    for (const patch of pending.current.values()) next = { ...next, ...patch };
    setSettings(next);
  }

  function save(patch: SettingsPatch): void {
    const request = ++latest.current;
    pending.current.set(request, patch);
    show();
    setFailed(false);
    void updateSettings(patch).then((result) => {
      pending.current.delete(request);
      if (!result.ok) {
        setFailed(true);
        show();
        return;
      }
      if (request > savedRequest.current) {
        savedRequest.current = request;
        saved.current = result.value.settings;
        setRemovedFocus(result.value.removedFocus);
      }
      if (result.value.completedToday) setCompletedToday(true);
      show();
    });
  }

  return { settings, failed, removedFocus, completedToday, save };
}
