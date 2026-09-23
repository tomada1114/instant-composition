import { useTranslations } from "next-intl";
import { useId, type ReactElement } from "react";

import type { DailySize, SubtopicRef, TopicInfo } from "../../core/types";
import { TUNING } from "../../core/tuning";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { Segmented } from "@/components/ui/segmented";
import { SelectCard } from "@/components/ui/select-card";

import type { SettingsState } from "./use-settings";

function Heading({
  id,
  children,
}: Readonly<{ id: string; children: string }>): ReactElement {
  return (
    <h2 id={id} className="text-label text-muted-foreground">
      {children}
    </h2>
  );
}

/** The topics, at least one kept: the last chosen card cannot be pressed off. */
export function TopicsSection({
  topics,
  state,
}: Readonly<{ topics: readonly TopicInfo[]; state: SettingsState }>): ReactElement {
  const t = useTranslations("Settings.topics");
  const id = useId();
  const chosen = state.settings.topics;
  function toggle(topicId: string): void {
    const next = chosen.includes(topicId)
      ? chosen.filter((other) => other !== topicId)
      : [...chosen, topicId];
    state.save({
      topics: topics.map((topic) => topic.id).filter((other) => next.includes(other)),
    });
  }
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <Heading id={id}>{t("title")}</Heading>
      <ul className="flex flex-col gap-3">
        {topics.map((topic) => {
          const selected = chosen.includes(topic.id);
          return (
            <li key={topic.id}>
              <SelectCard
                title={topic.ja}
                detail={topic.subtopics.map((subtopic) => subtopic.ja).join(" ・ ")}
                selected={selected}
                disabled={selected && chosen.length === 1}
                onToggle={() => {
                  toggle(topic.id);
                }}
              />
            </li>
          );
        })}
      </ul>
      {chosen.length === 1 ? (
        <p className="text-caption text-muted-foreground">{t("keepOne")}</p>
      ) : null}
    </section>
  );
}

function same(a: SubtopicRef, b: SubtopicRef): boolean {
  return a.topic === b.topic && a.subtopic === b.subtopic;
}

/** The chosen topics' subtopics as chips; two at most, then the rest stop taking presses. */
export function FocusSection({
  topics,
  state,
}: Readonly<{ topics: readonly TopicInfo[]; state: SettingsState }>): ReactElement {
  const t = useTranslations("Settings.focus");
  const id = useId();
  const { focus } = state.settings;
  const full = focus.length >= TUNING.maxFocus;
  const offered = topics
    .filter((topic) => state.settings.topics.includes(topic.id))
    .flatMap((topic) =>
      topic.subtopics.map((subtopic) => ({
        topic: topic.id,
        subtopic: subtopic.id,
        ja: subtopic.ja,
      })),
    );
  const names = (refs: readonly SubtopicRef[]): string =>
    refs
      .map(
        (ref) =>
          topics
            .find((topic) => topic.id === ref.topic)
            ?.subtopics.find((s) => s.id === ref.subtopic)?.ja ?? ref.subtopic,
      )
      .join("・");
  return (
    <section className="flex flex-col gap-3">
      <Heading id={id}>{t("title")}</Heading>
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-2">
        {offered.map((ref) => {
          const selected = focus.some((chosen) => same(chosen, ref));
          return (
            <ChoiceChip
              key={`${ref.topic}/${ref.subtopic}`}
              label={ref.ja}
              selected={selected}
              disabled={!selected && full}
              onToggle={() => {
                const { topic, subtopic } = ref;
                state.save({
                  focus: selected
                    ? focus.filter((chosen) => !same(chosen, ref))
                    : [...focus, { topic, subtopic }],
                });
              }}
            />
          );
        })}
      </div>
      <p className="text-caption text-muted-foreground">
        {full ? t("limit") : t("note")}
      </p>
      {state.removedFocus.length > 0 ? (
        <p role="status">{t("removed", { names: names(state.removedFocus) })}</p>
      ) : null}
    </section>
  );
}

/** The daily size, applied to today's portion at once. */
export function SizeSection({
  state,
}: Readonly<{ state: SettingsState }>): ReactElement {
  const t = useTranslations("Settings.size");
  const id = useId();
  return (
    <section className="flex flex-col gap-3">
      <Heading id={id}>{t("title")}</Heading>
      <Segmented<DailySize>
        label={t("title")}
        options={TUNING.dailySizes.map((size) => ({
          value: size,
          label: t("count", { count: size }),
          text: String(size),
        }))}
        value={state.settings.dailySize}
        onChange={(dailySize) => {
          state.save({ dailySize });
        }}
      />
      <p className="text-caption text-muted-foreground">{t("note")}</p>
      {state.completedToday ? <p role="status">{t("completed")}</p> : null}
    </section>
  );
}
