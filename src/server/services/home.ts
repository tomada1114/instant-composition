import { addDays } from "../../core/day";
import { homeState, type PortionProgress } from "../../core/home-state";
import { weekDots } from "../../core/streak";
import { estimateMinutes } from "../../core/timer";
import { TUNING } from "../../core/tuning";
import type { DayKey } from "../../core/types";
import type { HomePreview, HomeView, RoundSummary } from "../../core/views";
import { availableFor, deal, seedFor } from "./deck";
import type { ServiceDeps } from "./deps";
import { portionProgress, readProgress, type Progress } from "./progress";

function preview(
  deps: ServiceDeps,
  progress: Progress,
  twoPortions: boolean,
): HomePreview | undefined {
  const setting = progress.settings?.dailySize ?? TUNING.defaultDailySize;
  const size =
    deps.store.getPortion(progress.today)?.target ??
    Math.min(setting, availableFor(progress));
  const dealt = deal(progress, { size, seed: seedFor(deps, progress, "today") });
  if (!dealt.ok) {
    return undefined;
  }
  const focusNames = (progress.settings?.focus ?? []).map(
    (ref) =>
      progress.content.topics
        .find((topic) => topic.id === ref.topic)
        ?.subtopics.find((sub) => sub.id === ref.subtopic)?.ja ?? ref.subtopic,
  );
  return {
    size,
    setting,
    shortage: size < setting,
    reviewCount: dealt.value.reviewCount,
    newCount: dealt.value.newCount,
    focusNames,
    minutes: estimateMinutes(twoPortions ? size * 2 : size),
  };
}

/** Everything the start screen shows. */
export function home(deps: ServiceDeps): HomeView {
  const progress = readProgress(deps);
  const { today } = progress;
  deps.store.abandonOpenRoundsBefore(today, progress.now);

  const portions = new Map<DayKey, PortionProgress>();
  for (const day of [today, addDays(today, -1)]) {
    const portion = deps.store.getPortion(day);
    if (portion !== undefined) {
      portions.set(day, {
        target: portion.target,
        progress: portionProgress(deps, progress.answers, day),
      });
    }
  }
  const active = deps.store.activeRound(today);
  const state = homeState({
    hasSettings: progress.settings !== undefined,
    hasLevel: progress.level !== undefined,
    today,
    completed: progress.completed,
    portions,
    activeRound: active,
    available: progress.contentError ? 0 : availableFor(progress),
  });

  const firstToday = progress.answers.filter(
    (answer) => answer.day === today && answer.pass === "first",
  );
  return {
    state,
    week: weekDots(progress.completed, today, progress.firstDay),
    preview:
      state.kind === "ready" || state.kind === "recover-offer"
        ? preview(deps, progress, state.kind === "recover-offer")
        : undefined,
    todayRounds: deps.store.roundsOn(today).filter((round) => round.finishedAt !== null)
      .length,
    todayCards: firstToday.length,
    dailySize: progress.settings?.dailySize ?? TUNING.defaultDailySize,
    sound: progress.settings?.sound ?? true,
    contentError: progress.contentError,
  };
}

/** The saved summary of today's last finished round, for reading back. */
export function recap(deps: ServiceDeps): RoundSummary | undefined {
  const { today } = readProgress(deps);
  const last = deps.store
    .roundsOn(today)
    .filter((round) => round.finishedAt !== null)
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
    .at(-1);
  return last?.summary === undefined || last.summary === null
    ? undefined
    : (last.summary as RoundSummary);
}
