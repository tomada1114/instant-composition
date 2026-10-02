import type { ReactElement, ReactNode } from "react";
import { useTranslations } from "use-intl";

import type { SettingsPageView } from "../openapi";
import { LevelPicker } from "../settings/level-picker";
import { Button } from "../ui/button";
import { Eyebrow } from "../ui/eyebrow";
import { ArrowGlyph, BackGlyph } from "../ui/glyphs";
import { IconButton } from "../ui/icon-button";
import { Kbd } from "../ui/kbd";

/** A later step of W1: ← back a step, its heading, what it offers, its actions at the foot. */
function WelcomeStep({
  title,
  note,
  onBack,
  failed,
  footer,
  children,
}: Readonly<{
  title: string;
  note: string;
  onBack: () => void;
  failed: boolean;
  footer: ReactNode;
  children?: ReactNode;
}>): ReactElement {
  const t = useTranslations("Welcome");
  return (
    <main className="mx-auto flex min-h-dvh max-w-reading flex-col gap-8 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-3">
        <IconButton
          type="button"
          aria-label={t("back")}
          onClick={onBack}
          className="mb-3"
        >
          <BackGlyph />
        </IconButton>
        <Eyebrow aria-hidden>{t("eyebrow")}</Eyebrow>
        <h1 className="text-heading">{title}</h1>
        <p className="text-caption text-muted-foreground">{note}</p>
      </div>
      {children}
      <div className="flex flex-col gap-3">
        {failed ? (
          <p role="alert" className="rounded-control bg-raised px-4 py-3">
            {t("saveFailed")}
          </p>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
          {footer}
        </div>
      </div>
    </main>
  );
}

/** How to start: measure with the placement round, or pick a level by hand. */
export function StartStep({
  saving,
  failed,
  onMeasure,
  onChoose,
  onBack,
}: Readonly<{
  saving: boolean;
  failed: boolean;
  onMeasure: () => void;
  onChoose: () => void;
  onBack: () => void;
}>): ReactElement {
  const t = useTranslations("Welcome.start");
  return (
    <WelcomeStep
      title={t("title")}
      note={t("note")}
      onBack={onBack}
      failed={failed}
      footer={
        <>
          <Button
            data-primary
            className="w-full sm:w-auto sm:min-w-48"
            disabled={saving}
            onClick={onMeasure}
          >
            {t("measure")}
            <ArrowGlyph className="size-4.5" />
            <Kbd>Space</Kbd>
          </Button>
          <Button
            variant="secondary"
            className="w-full sm:w-auto sm:min-w-48"
            disabled={saving}
            onClick={onChoose}
          >
            {t("choose")}
          </Button>
        </>
      }
    />
  );
}

/** The learner's current level, picked by its TOEIC reference; no placement follows. */
export function LevelStep({
  levels,
  level,
  onLevel,
  saving,
  failed,
  onStart,
  onBack,
}: Readonly<{
  levels: SettingsPageView["levels"];
  level: number | null;
  onLevel: (level: number) => void;
  saving: boolean;
  failed: boolean;
  onStart: () => void;
  onBack: () => void;
}>): ReactElement {
  const t = useTranslations("Welcome.level");
  return (
    <WelcomeStep
      title={t("title")}
      note={t("note")}
      onBack={onBack}
      failed={failed}
      footer={
        <Button
          data-primary
          className="w-full sm:w-auto sm:min-w-48"
          disabled={level === null || saving}
          onClick={onStart}
        >
          {t("start")}
          <ArrowGlyph className="size-4.5" />
          <Kbd>Space</Kbd>
        </Button>
      }
    >
      <LevelPicker levels={levels} value={level} onChange={onLevel} />
    </WelcomeStep>
  );
}
