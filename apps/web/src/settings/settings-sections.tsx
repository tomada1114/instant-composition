import { useId, useState, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { TUNING } from "../lib/tuning";
import type { SubtopicRef, TopicInfo } from "../openapi";
import { ChoiceChip } from "../ui/choice-chip";
import { SelectCard } from "../ui/select-card";
import { SettingsRow } from "./settings-row";
import type { SettingsState } from "./use-settings";

/** The topics, at least one kept: the last chosen card cannot be pressed off. */
export function TopicsSection({
  topics,
  state,
}: Readonly<{ topics: readonly TopicInfo[]; state: SettingsState }>): ReactElement {
  const t = useTranslations("Settings.topics");
  const id = useId();
  const [refused, setRefused] = useState(false);
  const chosen = state.settings.topics;
  function toggle(topicId: string): void {
    if (chosen.length === 1 && chosen.includes(topicId)) {
      setRefused(true);
      return;
    }
    setRefused(false);
    const next = chosen.includes(topicId)
      ? chosen.filter((other) => other !== topicId)
      : [...chosen, topicId];
    state.save({
      topics: topics.map((topic) => topic.id).filter((other) => next.includes(other)),
    });
  }
  return (
    <SettingsRow wide id={id} label={t("title")}>
      <ul aria-labelledby={id} className="grid grid-cols-2 gap-2">
        {topics.map((topic) => {
          const selected = chosen.includes(topic.id);
          return (
            <li key={topic.id}>
              <SelectCard
                compact
                title={topic.name}
                detail={topic.subtopics.map((subtopic) => subtopic.name).join("・")}
                selected={selected}
                locked={selected && chosen.length === 1}
                onToggle={() => {
                  toggle(topic.id);
                }}
              />
            </li>
          );
        })}
      </ul>
      <p role="status" className="text-caption text-muted-foreground empty:hidden">
        {refused ? t("keepOne") : ""}
      </p>
    </SettingsRow>
  );
}

function same(a: SubtopicRef, b: SubtopicRef): boolean {
  return a.topic === b.topic && a.subtopic === b.subtopic;
}

/**
 * The chosen topics' subtopics as chips; two at most, then the rest stop
 * taking presses.
 */
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
        name: subtopic.name,
      })),
    );
  const names = (refs: readonly SubtopicRef[]): string =>
    refs
      .map(
        (ref) =>
          topics
            .find((topic) => topic.id === ref.topic)
            ?.subtopics.find((s) => s.id === ref.subtopic)?.name ?? ref.subtopic,
      )
      .join("・");
  return (
    <SettingsRow
      wide
      id={id}
      label={t("title")}
      aside={t("count", { count: focus.length, max: TUNING.maxFocus })}
    >
      <div
        role="group"
        aria-labelledby={id}
        className="flex flex-wrap content-start gap-2"
      >
        {offered.map((ref) => {
          const selected = focus.some((chosen) => same(chosen, ref));
          return (
            <ChoiceChip
              key={`${ref.topic}/${ref.subtopic}`}
              label={ref.name}
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
      {state.removedFocus.length > 0 ? (
        <p role="status">{t("removed", { names: names(state.removedFocus) })}</p>
      ) : null}
    </SettingsRow>
  );
}
