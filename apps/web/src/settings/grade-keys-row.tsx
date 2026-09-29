import { useId, useState, type KeyboardEvent, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { isGradeKey, keyLabel } from "../lib/grade-keys";
import { cn } from "../lib/utils";
import type { GradeKeys } from "../openapi";
import { CloseGlyph, RingGlyph } from "../ui/glyphs";
import type { SettingsState } from "./use-settings";

type Grade = keyof GradeKeys;

/** Pressed on their own they only start a combination, so a waiting key ignores them. */
const PASSED_ON = new Set(["Shift", "Control", "Alt", "Meta", "Tab"]);

/**
 * The keys the drill grades with, × then ○ as the drill sets them. A key
 * pressed and released waits for the next key and takes it: an arrow, a
 * digit or a letter the other grade does not have. Anything else is refused
 * on the press, Esc gives up, and leaving the key gives up too.
 */
export function GradeKeysRow({
  state,
}: Readonly<{ state: SettingsState }>): ReactElement {
  const t = useTranslations("Settings.keys");
  const titleId = useId();
  const [waiting, setWaiting] = useState<Grade | null>(null);
  const [refusal, setRefusal] = useState<"notAllowed" | "taken" | null>(null);
  const keys = state.settings.gradeKeys;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, grade: Grade): void {
    if (waiting !== grade || event.nativeEvent.isComposing) return;
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
    if (code === (grade === "ok" ? keys.ng : keys.ok)) {
      setRefusal("taken");
      return;
    }
    setWaiting(null);
    setRefusal(null);
    if (code === keys[grade]) return;
    state.save({
      gradeKeys: grade === "ok" ? { ok: code, ng: keys.ng } : { ok: keys.ok, ng: code },
    });
  }

  // A function rather than a component: a component made during render would
  // remount on every change, taking the focus the waiting key depends on.
  function keyButton(grade: Grade): ReactElement {
    const listening = waiting === grade;
    const Glyph = grade === "ok" ? RingGlyph : CloseGlyph;
    return (
      <button
        type="button"
        aria-label={t(grade, { key: listening ? t("waiting") : keyLabel(keys[grade]) })}
        onClick={(event) => {
          // Safari leaves a clicked button unfocused, and the key is read on it.
          event.currentTarget.focus();
          setWaiting(grade);
          setRefusal(null);
        }}
        onKeyDown={(event) => {
          onKeyDown(event, grade);
        }}
        onBlur={() => {
          if (!listening) return;
          setWaiting(null);
          setRefusal(null);
        }}
        className={cn(
          "flex h-11 min-w-16 items-center justify-center gap-1.5 rounded-tile px-3",
          listening
            ? "bg-primary text-primary-foreground"
            : "bg-raised text-foreground",
        )}
      >
        <Glyph className="size-4" />
        {listening ? (
          <span className="text-label">{t("waiting")}</span>
        ) : (
          <span className="font-mono text-mono-sm">{keyLabel(keys[grade])}</span>
        )}
      </button>
    );
  }

  return (
    <div className="flex flex-col border-t border-border">
      <div className="flex min-h-16 items-center justify-between gap-4">
        <h2 id={titleId}>{t("title")}</h2>
        <div role="group" aria-labelledby={titleId} className="flex gap-2">
          {keyButton("ng")}
          {keyButton("ok")}
        </div>
      </div>
      <p role="status" className="pb-3 text-caption text-muted-foreground empty:hidden">
        {refusal === null ? "" : t(refusal)}
      </p>
    </div>
  );
}
