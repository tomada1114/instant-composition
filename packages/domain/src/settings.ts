import type { PracticeError } from "./errors";
import { gradeKeysOf, isGradeKeyPair } from "./grade-keys";
import { err, ok, type Result } from "./result";
import { TUNING, VOCAB_TUNING } from "./tuning";
import type {
  DailySize,
  DrillNewPerDay,
  DrillReviewsPerDay,
  GradeKeys,
  LimitSeconds,
  Settings,
  SubtopicRef,
  TopicInfo,
  VocabNewPerDay,
  VocabReviewsPerDay,
} from "./types";

/** A new learner's settings; the limit is left unchosen, so the default stands in. */
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
  readonly limitSeconds?: LimitSeconds;
  /** Every key at once, so they are judged together; without `hard`, it is derived. */
  readonly gradeKeys?: GradeKeys;
  readonly newPerDay?: DrillNewPerDay;
  readonly reviewsPerDay?: DrillReviewsPerDay;
  readonly vocabNewPerDay?: VocabNewPerDay;
  readonly vocabReviewsPerDay?: VocabReviewsPerDay;
}

/** The drill's daily limits the learner chose, or the defaults for those never chosen. */
export function drillLimitsOf(settings: Settings | undefined): {
  readonly newPerDay: DrillNewPerDay;
  readonly reviewsPerDay: DrillReviewsPerDay;
} {
  return {
    newPerDay: settings?.newPerDay ?? TUNING.defaultNewPerDay,
    reviewsPerDay:
      settings?.reviewsPerDay === undefined
        ? TUNING.defaultReviewsPerDay
        : settings.reviewsPerDay,
  };
}

/** The per-card limit the learner chose, or the default when they never chose one. */
export function limitSecondsOf(settings: Settings | undefined): LimitSeconds {
  return settings?.limitSeconds ?? TUNING.defaultLimitSeconds;
}

/** The vocabulary's daily limits the learner chose, or the defaults for those never chosen. */
export function vocabLimitsOf(settings: Settings | undefined): {
  readonly newPerDay: VocabNewPerDay;
  readonly reviewsPerDay: VocabReviewsPerDay;
} {
  return {
    newPerDay: settings?.vocabNewPerDay ?? VOCAB_TUNING.defaultNewPerDay,
    reviewsPerDay:
      settings?.vocabReviewsPerDay === undefined
        ? VOCAB_TUNING.defaultReviewsPerDay
        : settings.vocabReviewsPerDay,
  };
}

/** The settings as a client reads them: every field present, a default for one never chosen. */
export type ShownSettings = Required<Omit<Settings, "gradeKeys">> & {
  readonly gradeKeys: Required<GradeKeys>;
};

/** The settings with a default in every field never chosen; see {@link ShownSettings}. */
export function withDefaults(settings: Settings): ShownSettings {
  const drill = drillLimitsOf(settings);
  const vocab = vocabLimitsOf(settings);
  return {
    ...settings,
    limitSeconds: limitSecondsOf(settings),
    gradeKeys: gradeKeysOf(settings),
    newPerDay: drill.newPerDay,
    reviewsPerDay: drill.reviewsPerDay,
    vocabNewPerDay: vocab.newPerDay,
    vocabReviewsPerDay: vocab.reviewsPerDay,
  };
}

function offered<T>(options: readonly T[], value: T | undefined): boolean {
  return value === undefined || options.includes(value);
}

/** Whether each daily limit `patch` sets, the drill's and the vocabulary's, is on offer. */
function offersLimits(patch: SettingsPatch): boolean {
  return (
    offered<number>(TUNING.newPerDay, patch.newPerDay) &&
    offered<number | null>(TUNING.reviewsPerDay, patch.reviewsPerDay) &&
    offered<number>(VOCAB_TUNING.newPerDay, patch.vocabNewPerDay) &&
    offered<number | null>(VOCAB_TUNING.reviewsPerDay, patch.vocabReviewsPerDay)
  );
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
 * `TUNING.maxFocus` focus subtopics are kept, removing a topic removes its
 * focus too, the grade keys must pass `isGradeKeyPair`, and each daily limit
 * must be one `TUNING` or `VOCAB_TUNING` offers.
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
  if (
    (patch.gradeKeys !== undefined && !isGradeKeyPair(patch.gradeKeys)) ||
    !offersLimits(patch)
  ) {
    return err({ code: "ERR_BAD_REQUEST" });
  }
  const limitSeconds = patch.limitSeconds ?? current.limitSeconds;
  const gradeKeys = patch.gradeKeys ?? current.gradeKeys;
  const newPerDay = patch.newPerDay ?? current.newPerDay;
  const reviewsPerDay =
    patch.reviewsPerDay === undefined ? current.reviewsPerDay : patch.reviewsPerDay;
  const vocabNewPerDay = patch.vocabNewPerDay ?? current.vocabNewPerDay;
  const vocabReviewsPerDay =
    patch.vocabReviewsPerDay === undefined
      ? current.vocabReviewsPerDay
      : patch.vocabReviewsPerDay;
  return ok({
    settings: {
      topics,
      focus: unique.filter((ref) => topics.includes(ref.topic)),
      dailySize: patch.dailySize ?? current.dailySize,
      sound: patch.sound ?? current.sound,
      ...(limitSeconds === undefined ? {} : { limitSeconds }),
      ...(gradeKeys === undefined ? {} : { gradeKeys }),
      ...(newPerDay === undefined ? {} : { newPerDay }),
      ...(reviewsPerDay === undefined ? {} : { reviewsPerDay }),
      ...(vocabNewPerDay === undefined ? {} : { vocabNewPerDay }),
      ...(vocabReviewsPerDay === undefined ? {} : { vocabReviewsPerDay }),
    },
    removedFocus: unique.filter((ref) => !topics.includes(ref.topic)),
  });
}
