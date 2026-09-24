import {
  addDays,
  availableFor,
  deal,
  EMPTY_STATS,
  estimateMinutes,
  homeState,
  ok,
  practiceState,
  seedFor,
  weekDots,
  type DayKey,
  type PortionProgress,
  type PracticeState,
  type Result,
  type Settings,
} from "@instant-composition/domain";

import { snapshotOrEmpty, type CatalogSnapshot } from "./catalog";
import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { storeFor, todayOf, type ApplicationDeps } from "./execute";
import { itemValues } from "./practice";
import type { HomePreview, HomeView } from "./query-views";

function preview(
  practice: PracticeState,
  settings: Settings | undefined,
  snapshot: CatalogSnapshot,
  portionTarget: number | undefined,
  roundsStarted: number,
  twoPortions: boolean,
): HomePreview | undefined {
  const setting = practice.dailySize;
  const size = portionTarget ?? Math.min(setting, availableFor(practice));
  const dealt = deal(practice, {
    size,
    seed: seedFor(practice.today, "today", roundsStarted),
  });
  if (!dealt.ok) {
    return undefined;
  }
  const focusNames = (settings?.focus ?? []).map(
    (ref) =>
      snapshot.topics
        .find((topic) => topic.id === ref.topic)
        ?.subtopics.find((sub) => sub.id === ref.subtopic)?.name ?? ref.subtopic,
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

/** Everything the start screen shows, from point lookups: nothing replays the log. */
export async function home(
  deps: ApplicationDeps,
  context: RequestContext,
): Promise<Result<HomeView, ApplicationError>> {
  const bound = storeFor(deps, context, "home");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  const today = todayOf(context);
  const yesterday = addDays(today, -1);
  const [
    { snapshot, unreadable },
    settings,
    stats,
    items,
    portionToday,
    portionYesterday,
    tallies,
  ] = await Promise.all([
    snapshotOrEmpty(deps.catalog),
    store.settings(),
    store.stats(),
    store.items(),
    store.portion(today),
    store.portion(yesterday),
    store.days([today]),
  ]);
  const totals = stats?.value ?? EMPTY_STATS;
  const completed = new Set(totals.completedDays);
  const open =
    totals.openRound?.day === today
      ? await store.round(totals.openRound.id)
      : undefined;
  const practice = practiceState({
    today,
    stats: totals,
    settings: settings?.value,
    cards: [...snapshot.shown.values()],
    items: itemValues(items),
  });
  const portions = new Map<DayKey, PortionProgress>(
    [portionToday, portionYesterday].flatMap((portion) =>
      portion === undefined
        ? []
        : [
            [
              portion.value.day,
              { target: portion.value.target, progress: portion.value.progress },
            ] as const,
          ],
    ),
  );
  const state = homeState({
    hasSettings: settings !== undefined,
    hasLevel: totals.level !== null,
    today,
    completed,
    portions,
    activeRound: open?.value,
    available: unreadable ? 0 : availableFor(practice),
  });
  const tally = tallies.get(today)?.value;
  return ok({
    state,
    week: weekDots(completed, today, totals.firstDay ?? undefined),
    preview:
      state.kind === "ready" || state.kind === "recover-offer"
        ? preview(
            practice,
            settings?.value,
            snapshot,
            portionToday?.value.target,
            tally?.roundsStarted ?? 0,
            state.kind === "recover-offer",
          )
        : undefined,
    todayRounds: tally?.roundsFinished ?? 0,
    todayCards: tally?.firstPass ?? 0,
    todayLastRoundId: tally?.lastFinishedRound ?? undefined,
    dailySize: practice.dailySize,
    sound: settings?.value.sound ?? true,
    contentError: unreadable,
  });
}
