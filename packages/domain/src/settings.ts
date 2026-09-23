import type { PracticeError } from "./errors";
import { err, ok, type Result } from "./result";
import { TUNING } from "./tuning";
import type { DailySize, Settings, SubtopicRef, TopicInfo } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  topics: [],
  focus: [],
  dailySize: TUNING.defaultDailySize,
  sound: true,
};

/** The fields a settings change sets; the rest keep their value. */
export interface SettingsPatch {
  readonly topics?: readonly string[];
  readonly focus?: readonly SubtopicRef[];
  readonly dailySize?: DailySize;
  readonly sound?: boolean;
}

export interface SettingsDecided {
  readonly settings: Settings;
  /** Focus removed because its topic was deselected. */
  readonly removedFocus: readonly SubtopicRef[];
}

function sameRef(a: SubtopicRef, b: SubtopicRef): boolean {
  return a.topic === b.topic && a.subtopic === b.subtopic;
}

function isKnownRef(taxonomy: readonly TopicInfo[], ref: SubtopicRef): boolean {
  return taxonomy.some(
    (topic) =>
      topic.id === ref.topic && topic.subtopics.some((sub) => sub.id === ref.subtopic),
  );
}

/**
 * The settings after `patch`. The last topic cannot be removed, at most
 * `TUNING.maxFocus` focus subtopics are kept, and removing a topic removes its
 * focus too.
 */
export function decideSettings(
  current: Settings,
  patch: SettingsPatch,
  taxonomy: readonly TopicInfo[],
): Result<SettingsDecided, PracticeError> {
  const requested = patch.topics ?? current.topics;
  if (requested.some((id) => !taxonomy.some((topic) => topic.id === id))) {
    return err({ code: "ERR_BAD_REQUEST" });
  }
  const topics = taxonomy
    .map((topic) => topic.id)
    .filter((id) => requested.includes(id));
  if (topics.length === 0) {
    return err({ code: "ERR_BAD_REQUEST" });
  }

  const wanted = patch.focus ?? current.focus;
  const unique = wanted.filter(
    (ref, index) => wanted.findIndex((other) => sameRef(other, ref)) === index,
  );
  if (
    patch.focus !== undefined &&
    (unique.length > TUNING.maxFocus ||
      unique.some((ref) => !isKnownRef(taxonomy, ref) || !topics.includes(ref.topic)))
  ) {
    return err({ code: "ERR_BAD_REQUEST" });
  }
  return ok({
    settings: {
      topics,
      focus: unique.filter((ref) => topics.includes(ref.topic)),
      dailySize: patch.dailySize ?? current.dailySize,
      sound: patch.sound ?? current.sound,
    },
    removedFocus: unique.filter((ref) => !topics.includes(ref.topic)),
  });
}
