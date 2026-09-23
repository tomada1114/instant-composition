"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactElement } from "react";

import type { TopicInfo } from "../../core/types";
import { saveSettings } from "@/components/lib/api";
import { usePrimaryKey } from "@/components/lib/use-primary-key";
import { Button } from "@/components/ui/button";
import { SelectCard } from "@/components/ui/select-card";

import { useRouter } from "../../i18n/navigation";

/** W1: the first visit picks the topics, then goes straight on to the placement round. */
export function WelcomeScreen({
  topics,
}: Readonly<{ topics: readonly TopicInfo[] }>): ReactElement {
  const t = useTranslations("Welcome");
  const router = useRouter();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  usePrimaryKey();

  function toggle(id: string): void {
    setChosen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function next(): void {
    setSaving(true);
    setFailed(false);
    const picked = topics
      .filter((topic) => chosen.has(topic.id))
      .map((topic) => topic.id);
    void saveSettings({ topics: picked }).then((saved) => {
      if (saved.ok) {
        router.push("/drill?kind=placement");
        return;
      }
      setSaving(false);
      setFailed(true);
    });
  }

  return (
    <main className="mx-auto box-content flex min-h-[calc(100dvh-4rem)] max-w-column flex-col gap-8 px-4 py-8">
      <div className="flex flex-col gap-2">
        <h1>{t("title")}</h1>
        <p>{t("prompt")}</p>
        <p className="text-caption text-muted-foreground">{t("note")}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {topics.map((topic) => (
          <li key={topic.id}>
            <SelectCard
              title={topic.ja}
              detail={topic.subtopics.map((subtopic) => subtopic.ja).join(" ・ ")}
              selected={chosen.has(topic.id)}
              onToggle={() => {
                toggle(topic.id);
              }}
            />
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-col gap-3">
        {failed ? (
          <p role="alert" className="rounded-tile bg-raised px-4 py-3">
            {t("saveFailed")}
          </p>
        ) : null}
        {chosen.size === 0 ? (
          <p className="text-caption text-muted-foreground">{t("needOne")}</p>
        ) : null}
        <Button
          data-primary
          className="w-full"
          disabled={chosen.size === 0 || saving}
          onClick={next}
        >
          {t("next")}
        </Button>
      </div>
    </main>
  );
}
