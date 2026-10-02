import type { PracticeError } from "./errors";
import { err, ok, type Result } from "./result";
import { TUNING, VOCAB_TUNING } from "./tuning";
import type {
  DailySize,
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
  /** Both keys at once, so the pair is judged whole. */
  readonly gradeKeys?: GradeKeys;
  readonly vocabNewPerDay?: VocabNewPerDay;
  readonly vocabReviewsPerDay?: VocabReviewsPerDay;
}

/**
 * The `KeyboardEvent.code` values a grade may take: ↑ ↓ ← →, 0–9 and A–Z.
 * Space, Enter, Esc and `?` (`Slash`) fall outside it, which keeps the drill's
 * own keys out of reach. The contract's `gradeKeySchema` states the same set.
 */
const GRADE_KEY = /^(?:Arrow(?:Up|Down|Left|Right)|Digit[0-9]|Key[A-Z])$/u;

/** Whether the drill may grade with `code`. */
export function isGradeKey(code: string): boolean {
  return GRADE_KEY.test(code);
}

/** Two keys the drill may grade with, a different one for each grade. */
export function isGradeKeyPair(pair: GradeKeys): boolean {
  return isGradeKey(pair.ok) && isGradeKey(pair.ng) && pair.ok !== pair.ng;
}

/** The grade keys the learner chose, or the default when they never chose any. */
export function gradeKeysOf(settings: Settings | undefined): GradeKeys {
  return settings?.gradeKeys ?? TUNING.defaultGradeKeys;
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
export function withDefaults(settings: Settings): Required<Settings> {
  const vocab = vocabLimitsOf(settings);
  return {
    ...settings,
    limitSeconds: limitSecondsOf(settings),
    gradeKeys: gradeKeysOf(settings),
    vocabNewPerDay: vocab.newPerDay,
    vocabReviewsPerDay: vocab.reviewsPerDay,
  };
}

/** Whether each vocabulary limit `patch` sets is one the settings offer. */
function offersVocabLimits(patch: SettingsPatch): boolean {
  const { vocabNewPerDay, vocabReviewsPerDay } = patch;
  return (
    (vocabNewPerDay === undefined ||
      (VOCAB_TUNING.newPerDay as readonly number[]).includes(vocabNewPerDay)) &&
    (vocabReviewsPerDay === undefined ||
      (VOCAB_TUNING.reviewsPerDay as readonly (number | null)[]).includes(
        vocabReviewsPerDay,
      ))
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
 * focus too, a grade key pair must pass `isGradeKeyPair`, and each vocabulary
 * limit must be one `VOCAB_TUNING` offers.
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
    !offersVocabLimits(patch)
  ) {
    return err({ code: "ERR_BAD_REQUEST" });
  }
  const limitSeconds = patch.limitSeconds ?? current.limitSeconds;
  const gradeKeys = patch.gradeKeys ?? current.gradeKeys;
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
      ...(vocabNewPerDay === undefined ? {} : { vocabNewPerDay }),
      ...(vocabReviewsPerDay === undefined ? {} : { vocabReviewsPerDay }),
    },
    removedFocus: unique.filter((ref) => !topics.includes(ref.topic)),
  });
}
