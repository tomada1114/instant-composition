import { useRef, useState, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { updateLevel, updateProfile, updateSettings } from "../lib/endpoints";
import { usePrimaryKey } from "../lib/use-primary-key";
import type { SettingsPageView, TopicInfo } from "../openapi";
import { Button } from "../ui/button";
import { Eyebrow } from "../ui/eyebrow";
import { ArrowGlyph } from "../ui/glyphs";
import { Kbd } from "../ui/kbd";
import { SelectCard } from "../ui/select-card";
import { LoadFailedPanel } from "./home-empty";
import { LevelStep, StartStep } from "./welcome-steps";

/** The time zone this browser runs in, as an IANA name such as `Asia/Tokyo`. */
function browserTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

type Step = "topics" | "start" | "level";

/**
 * W1: the first visit picks the topics, then how to start — measuring, on to
 * the placement round (`onSaved`), or picking a level by hand, on to the
 * start screen with no placement (`onChosen`). Nothing is saved until that
 * last choice, so leaving halfway starts the welcome again. `onReload` reads
 * the topics again, for when there were none to offer.
 *
 * Saving the choice first sends the browser's time zone, so the first round
 * is already dated in it. That happens once: this screen is shown only until
 * topics are saved, which the API records, so no later visit on any device
 * sends it again whatever its storage holds. A picked level is saved before
 * the topics, which end the welcome, so a home read never sees the topics
 * without it.
 */
export function WelcomeScreen({
  topics,
  levels,
  onSaved,
  onChosen,
  onReload,
}: Readonly<{
  topics: readonly TopicInfo[];
  levels: SettingsPageView["levels"];
  onSaved: () => void;
  onChosen: () => void;
  onReload: () => void;
}>): ReactElement {
  const t = useTranslations("Welcome");
  const [step, setStep] = useState<Step>("topics");
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [level, setLevel] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const zoneSent = useRef(false);
  /** A level picked earlier in this visit was saved, though the topics after it were not. */
  const manualSaved = useRef(false);
  usePrimaryKey();

  async function save(topicIds: string[], picked: number | null): Promise<boolean> {
    if (!zoneSent.current) {
      const sent = await updateProfile({ timeZone: browserTimeZone() });
      // A zone the API does not know leaves the profile's own: go on without it.
      if (!sent.ok && sent.error.code !== "ERR_BAD_REQUEST") return false;
      zoneSent.current = true;
    }
    if (picked !== null) {
      if (!(await updateLevel({ mode: "manual", level: picked })).ok) return false;
      manualSaved.current = true;
    } else if (manualSaved.current) {
      // Measuring instead: an abandoned placement must not leave the pick fixed.
      if (!(await updateLevel({ mode: "auto" })).ok) return false;
      manualSaved.current = false;
    }
    return (await updateSettings({ topics: topicIds })).ok;
  }

  function toggle(id: string): void {
    setChosen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function finish(picked: number | null): void {
    setSaving(true);
    setFailed(false);
    const topicIds = topics
      .filter((topic) => chosen.has(topic.id))
      .map((topic) => topic.id);
    void save(topicIds, picked).then((saved) => {
      if (saved) {
        if (picked === null) onSaved();
        else onChosen();
        return;
      }
      setSaving(false);
      setFailed(true);
    });
  }

  function go(to: Step): void {
    setFailed(false);
    setStep(to);
  }

  if (topics.length === 0) {
    return (
      <main className="mx-auto box-content flex min-h-[calc(var(--column-height)-4rem)] max-w-column flex-col justify-center px-4 py-8">
        <LoadFailedPanel onReload={onReload} />
      </main>
    );
  }

  if (step === "start") {
    return (
      <StartStep
        saving={saving}
        failed={failed}
        onMeasure={() => {
          finish(null);
        }}
        onChoose={() => {
          go("level");
        }}
        onBack={() => {
          go("topics");
        }}
      />
    );
  }

  if (step === "level") {
    return (
      <LevelStep
        levels={levels}
        level={level}
        onLevel={setLevel}
        saving={saving}
        failed={failed}
        onStart={() => {
          finish(level);
        }}
        onBack={() => {
          go("start");
        }}
      />
    );
  }

  return (
    <main className="mx-auto box-content flex min-h-[calc(var(--column-height)-2rem)] max-w-column flex-col gap-8 px-4 pt-8 pb-3">
      <div className="flex flex-col gap-3">
        <Eyebrow aria-hidden>{t("eyebrow")}</Eyebrow>
        <h1 className="text-heading">{t("title")}</h1>
        <p className="text-caption text-muted-foreground">{t("note")}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {topics.map((topic) => (
          <li key={topic.id}>
            <SelectCard
              title={topic.name}
              detail={topic.subtopics.map((subtopic) => subtopic.name).join("・")}
              selected={chosen.has(topic.id)}
              onToggle={() => {
                toggle(topic.id);
              }}
            />
          </li>
        ))}
      </ul>
      <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-3 bg-background px-4 pt-2 pb-[calc(0.75rem+var(--safe-bottom))]">
        <Button
          data-primary
          className="w-full"
          disabled={chosen.size === 0}
          onClick={() => {
            go("start");
          }}
        >
          {t("next")}
          <ArrowGlyph className="size-4.5" />
          <Kbd>Space</Kbd>
        </Button>
      </div>
    </main>
  );
}
