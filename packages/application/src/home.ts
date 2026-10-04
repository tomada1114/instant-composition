import {
  addDays,
  EMPTY_STATS,
  estimateMinutes,
  gradeKeysOf,
  homeState,
  limitSecondsOf,
  ok,
  TALK_TUNING,
  TUNING,
  weekDots,
  weekOf,
  type DayKey,
  type PortionProgress,
  type Result,
} from "@instant-composition/domain";
import { snapshotOrEmpty } from "./catalog";
import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { storeFor, todayOf, type ApplicationDeps } from "./execute";
import { compositionProjection } from "./composition-load";
import { loadStreakStatus } from "./streak-maintenance";
import type { HomeView } from "./query-views";

/** Fixed point/range reads; independent maintenance publishes all progress-dependent figures. */
export async function home(
  deps: ApplicationDeps,
  context: RequestContext,
): Promise<Result<HomeView, ApplicationError>> {
  const bound = storeFor(deps, context, "home");
  if (!bound.ok) return bound;
  const store = bound.value;
  const today = todayOf(context);
  const yesterday = addDays(today, -1);
  const [
    { snapshot, unreadable },
    settings,
    stats,
    portionToday,
    portionYesterday,
    tallies,
    calendar,
  ] = await Promise.all([
    snapshotOrEmpty(deps.catalog),
    store.settings(),
    store.stats(),
    store.portion(today),
    store.portion(yesterday),
    store.days([today]),
    store.portionsPage({
      from: addDays(weekOf(today)[0] ?? today, -2),
      to: today,
      limit: 12,
    }),
  ]);
  const totals = stats?.value ?? EMPTY_STATS;
  if (totals.streak?.schema !== 1)
    return { ok: false, error: { code: "ERR_READ_MODEL_NOT_READY" } };
  const completed = new Set(
    calendar.entries
      .filter(({ value }) => value.completedAt !== null)
      .map(({ value }) => value.day),
  );
  const open =
    totals.openRound?.day === today
      ? await store.round(totals.openRound.id)
      : undefined;
  const status = await loadStreakStatus(store, today, totals.streak.longest);
  const tally = tallies.get(today);
  const projected = unreadable
    ? undefined
    : await compositionProjection(
        store,
        snapshot,
        today,
        settings,
        stats,
        portionToday,
        tally,
        context.now,
      );
  if (projected !== undefined && !projected.ok) return projected;
  const model = projected?.value;
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
    status,
    longest: totals.streak.longest,
    portions,
    activeRound: open?.value,
    available: model?.available ?? 0,
  });
  const preview =
    state.kind === "ready" || state.kind === "recover-offer"
      ? (model?.preview ?? undefined)
      : undefined;
  return ok({
    state,
    week: weekDots(completed, today, totals.firstDay ?? undefined),
    today,
    preview:
      preview === undefined
        ? undefined
        : {
            ...preview,
            minutes: estimateMinutes(
              preview.size * (state.kind === "recover-offer" ? 2 : 1),
              limitSecondsOf(settings?.value),
            ),
          },
    todayRounds: tally?.value.roundsFinished ?? 0,
    todayCards: tally?.value.firstPass ?? 0,
    todayLastRoundId: tally?.value.lastFinishedRound ?? undefined,
    dailySize: TUNING.extraSize,
    dayBoundaryHour: context.learner.dayBoundaryHour,
    talkTurns: TALK_TUNING.turns,
    sound: settings?.value.sound ?? true,
    gradeKeys: gradeKeysOf(settings?.value),
    contentError: unreadable,
  });
}
