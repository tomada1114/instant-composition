import { useId, useState, type KeyboardEvent, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { isGradeKey, keyLabel } from "../lib/grade-keys";
import { cn } from "../lib/utils";
import type { GradeKeyTrio } from "../openapi";
import { CloseGlyph, RingGlyph, TriangleGlyph } from "../ui/glyphs";
import type { SettingsState } from "./use-settings";

type Slot = keyof GradeKeyTrio;

/** The tiles left to right, as the drill's trio sets them: ×, △, then ○. */
const SLOTS: readonly Slot[] = ["ng", "hard", "ok"];
const GLYPHS = { ng: CloseGlyph, hard: TriangleGlyph, ok: RingGlyph } as const;

/** Pressed on their own they only start a combination, so a waiting key ignores them. */
const PASSED_ON = new Set(["Shift", "Control", "Alt", "Meta", "Tab"]);

/**
 * `key-picker`: the keys the drill grades with, × then △ then ○ as the drill
 * sets them. A key pressed and released waits for the next key and takes it:
 * an arrow, a digit or a letter no other grade has, saved with the other two
 * so the three are judged together. Anything else is refused on the press,
 * Esc gives up, and leaving the key gives up too. A pair stored before three
 * grades arrives with △'s key derived by the server, and shows as it.
 */
export function GradeKeysRow({
  state,
}: Readonly<{ state: SettingsState }>): ReactElement {
  const t = useTranslations("Settings.keys");
  const titleId = useId();
  const [waiting, setWaiting] = useState<Slot | null>(null);
  const [refusal, setRefusal] = useState<"notAllowed" | "taken" | null>(null);
  const keys = state.settings.gradeKeys;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, slot: Slot): void {
    if (waiting !== slot || event.nativeEvent.isComposing) return;
    if (PASSED_ON.has(event.key) || event.metaKey || event.ctrlKey || event.altKey)
      return;
    // Taken here alone: no window listener (Esc home, the drill) sees the key.
    event.preventDefault();
    event.stopPropagation();
    const { code } = event;
    if (event.key === "Escape") {
      setWaiting(null);
      setRefusal(null);
      return;
    }
    if (!isGradeKey(code)) {
      setRefusal("notAllowed");
      return;
    }
    if (SLOTS.some((other) => other !== slot && keys[other] === code)) {
      setRefusal("taken");
      return;
    }
    setWaiting(null);
    setRefusal(null);
    if (code === keys[slot]) return;
    state.save({ gradeKeys: { ...keys, [slot]: code } });
  }

  // A function rather than a component: a component made during render would
  // remount on every change, taking the focus the waiting key depends on.
  function keyButton(slot: Slot): ReactElement {
    const listening = waiting === slot;
    const Glyph = GLYPHS[slot];
    return (
      <button
        key={slot}
        type="button"
        aria-label={t(slot, { key: listening ? t("waiting") : keyLabel(keys[slot]) })}
        onClick={(event) => {
          // Safari leaves a clicked button unfocused, and the key is read on it.
          event.currentTarget.focus();
          setWaiting(slot);
          setRefusal(null);
        }}
        onKeyDown={(event) => {
          onKeyDown(event, slot);
        }}
        onBlur={() => {
          if (!listening) return;
          setWaiting(null);
          setRefusal(null);
        }}
        className={cn(
          "flex h-11 min-w-16 items-center justify-center gap-1.5 rounded-control border-2 bg-raised px-3 text-foreground",
          listening ? "border-foreground" : "border-input hover:bg-card",
        )}
      >
        <Glyph className="size-4" />
        {listening ? (
          <span className="text-label">{t("waiting")}</span>
        ) : (
          <span className="font-latin text-count">{keyLabel(keys[slot])}</span>
        )}
      </button>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 id={titleId}>{t("title")}</h3>
        <div role="group" aria-labelledby={titleId} className="flex gap-2">
          {SLOTS.map((slot) => keyButton(slot))}
        </div>
      </div>
      <p role="status" className="pb-3 text-caption text-muted-foreground empty:hidden">
        {refusal === null ? "" : t(refusal)}
      </p>
    </div>
  );
}
