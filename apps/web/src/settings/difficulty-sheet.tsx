import { useEffect, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import type { LevelMode, SettingsPageView } from "../openapi";
import { Button } from "../ui/button";
import { Segmented } from "../ui/segmented";
import { Sheet } from "../ui/sheet";
import { LevelPicker } from "./level-picker";
import type { LevelState } from "./use-level";

/**
 * The difficulty row's sheet: who moves the level, the level itself — a
 * pick fixes it by hand — and measuring again. Each change saves as it is
 * made; Esc and "close" close it.
 */
export function DifficultySheet({
  level,
  levels,
  onRetest,
  onClose,
}: Readonly<{
  level: LevelState;
  levels: SettingsPageView["levels"];
  onRetest: () => void;
  onClose: () => void;
}>): ReactElement {
  const t = useTranslations("Settings");
  const { view } = level;
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const current = view.level;
  return (
    <Sheet titleId="difficulty-title">
      <h2 id="difficulty-title" className="text-heading">
        {t("difficulty.title")}
      </h2>
      <div className="flex flex-col gap-3">
        {current === null ? null : (
          <Segmented<LevelMode>
            label={t("difficulty.mode")}
            options={(["auto", "manual"] as const).map((mode) => ({
              value: mode,
              label: t(`difficulty.${mode}`),
              text: t(`difficulty.${mode}`),
            }))}
            value={view.mode}
            onChange={(mode) => {
              level.choose(
                mode === "auto" ? { mode } : { mode: "manual", level: current },
              );
            }}
          />
        )}
        <LevelPicker
          levels={levels}
          value={current}
          onChange={(picked) => {
            level.choose({ mode: "manual", level: picked });
          }}
        />
        <p className="text-caption text-muted-foreground">
          {view.mode === "auto" ? t("difficulty.autoNote") : t("difficulty.manualNote")}
        </p>
        {level.failed ? (
          <p role="alert" className="rounded-tile bg-raised px-4 py-3">
            {t("saveFailed")}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-2.5">
        <Button variant="secondary" className="w-full" onClick={onRetest}>
          {t("difficulty.retest")}
        </Button>
        <Button data-autofocus className="w-full" onClick={onClose}>
          {t("difficulty.close")}
        </Button>
      </div>
    </Sheet>
  );
}
