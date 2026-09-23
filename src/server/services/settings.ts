import type { SettingsPatch } from "../../core/api";
import { err, ok, type Result } from "../../core/result";
import { TUNING } from "../../core/tuning";
import type { Settings, SubtopicRef, TopicInfo } from "../../core/types";
import type { SettingsView } from "../../core/views";
import { availableFor, refitDeck } from "./deck";
import type { ServiceDeps, ServiceError } from "./deps";
import { closeRound } from "./finish";
import { portionProgress, readProgress } from "./progress";

export const DEFAULT_SETTINGS: Settings = {
  topics: [],
  focus: [],
  dailySize: TUNING.defaultDailySize,
  sound: true,
};

function sameRef(a: SubtopicRef, b: SubtopicRef): boolean {
  return a.topic === b.topic && a.subtopic === b.subtopic;
}

function isKnownRef(topics: readonly TopicInfo[], ref: SubtopicRef): boolean {
  return topics.some(
    (topic) =>
      topic.id === ref.topic && topic.subtopics.some((sub) => sub.id === ref.subtopic),
  );
}

/**
 * Applies a new daily size to today's open portion: its target follows at
 * once, and when enough is already done the portion completes there and then,
 * closing the round under way. Otherwise that round's deck is cut or topped up.
 */
function applyDailySize(deps: ServiceDeps): boolean {
  const progress = readProgress(deps);
  const today = progress.today;
  const portion = deps.store.getPortion(today);
  if (portion?.completedAt !== null) {
    return false;
  }
  const done = portionProgress(deps, progress.answers, today);
  const target = Math.min(
    progress.settings?.dailySize ?? TUNING.defaultDailySize,
    done + availableFor(progress),
  );
  deps.store.setPortionTarget(today, target);
  const active = deps.store.activeRound(today);
  const open = active?.portionDay === today ? active : undefined;
  if (done >= target) {
    if (open === undefined) {
      const last = deps.store
        .roundsOn(today)
        .findLast((round) => round.portionDay === today);
      deps.store.completePortion(today, progress.now, last?.id ?? "settings");
    } else {
      deps.store.transaction(() => closeRound(deps, open));
    }
    return true;
  }
  if (open !== undefined) {
    refitDeck(deps, progress, open, target - done);
  }
  return false;
}

/**
 * Saves the fields `patch` sets. The last topic cannot be removed, at most two
 * focus subtopics are kept, and removing a topic removes its focus too.
 */
export function updateSettings(
  deps: ServiceDeps,
  patch: SettingsPatch,
): Result<SettingsView, ServiceError> {
  const loaded = deps.content.get();
  if (!loaded.ok) {
    return err({ code: "ERR_CONTENT_UNREADABLE" });
  }
  const taxonomy = loaded.value.topics;
  const current = deps.store.getSettings() ?? DEFAULT_SETTINGS;

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
    (ref, index) => wanted.findIndex((o) => sameRef(o, ref)) === index,
  );
  if (
    patch.focus !== undefined &&
    (unique.length > TUNING.maxFocus ||
      unique.some((ref) => !isKnownRef(taxonomy, ref) || !topics.includes(ref.topic)))
  ) {
    return err({ code: "ERR_BAD_REQUEST" });
  }
  const focus = unique.filter((ref) => topics.includes(ref.topic));
  const removedFocus = unique.filter((ref) => !topics.includes(ref.topic));

  const settings: Settings = {
    topics,
    focus,
    dailySize: patch.dailySize ?? current.dailySize,
    sound: patch.sound ?? current.sound,
  };
  deps.store.putSettings(settings);
  const completedToday =
    patch.dailySize !== undefined && patch.dailySize !== current.dailySize
      ? applyDailySize(deps)
      : false;
  return ok({ settings, removedFocus, completedToday });
}
