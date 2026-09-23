import {
  availableFor,
  decideSettings,
  DEFAULT_SETTINGS,
  ok,
  refitDeck,
  type Result,
  type Settings,
  type SettingsPatch,
} from "@instant-composition/domain";

import { loadClose, planClose } from "./close-round";
import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { committed, storeFor, type ApplicationDeps, type Write } from "./execute";
import { loadPractice, statsOf, type PracticeLoad } from "./practice";
import type { LearnerStore } from "./store";
import type { SettingsView } from "./views";

/**
 * A new daily size applied to today's open portion: its target follows at
 * once, and when enough is already done the portion completes there and then,
 * closing the round under way. Otherwise that round's deck is cut or topped up.
 */
async function applyDailySize(
  store: LearnerStore,
  load: PracticeLoad,
  settings: Settings,
  now: number,
): Promise<{ readonly completed: boolean; readonly writes: readonly Write[] }> {
  const today = load.practice.today;
  const stored = await store.portion(today);
  if (stored?.value.completedAt !== null) {
    return { completed: false, writes: [] };
  }
  const done = stored.value.progress;
  const portion = {
    ...stored.value,
    target: Math.min(settings.dailySize, done + availableFor(load.practice)),
  };
  const stats = statsOf(load);
  const open =
    stats.openRound?.day === today ? await store.round(stats.openRound.id) : undefined;
  const counting = open?.value.portionDay === today ? open : undefined;
  if (done >= portion.target) {
    if (counting !== undefined) {
      const close = await loadClose(store, counting);
      return {
        completed: true,
        writes: planClose(close, load.snapshot, settings.topics, now, portion).writes,
      };
    }
    return {
      completed: true,
      writes: [
        [
          {
            type: "portion",
            value: { ...portion, completedAt: now, completedRound: "settings" },
          },
          stored,
        ],
        [
          {
            type: "stats",
            value: { ...stats, completedDays: [...stats.completedDays, today] },
          },
          load.stats,
        ],
      ],
    };
  }
  const writes: Write[] = [[{ type: "portion", value: portion }, stored]];
  if (counting !== undefined) {
    const answered = new Set(
      (await store.reviewsOf(counting.value.id))
        .filter((review) => review.detail.pass === "first")
        .map((review) => review.item.id),
    );
    const deck = refitDeck(
      load.practice,
      counting.value,
      answered,
      portion.target - done,
    );
    if (deck.join() !== counting.value.deck.join()) {
      writes.push([{ type: "round", value: { ...counting.value, deck } }, counting]);
    }
  }
  return { completed: false, writes };
}

/**
 * Saves the fields `patch` sets. The last topic cannot be removed, at most two
 * focus subtopics are kept, and removing a topic removes its focus too.
 */
export async function updateSettings(
  deps: ApplicationDeps,
  context: RequestContext,
  patch: SettingsPatch,
): Promise<Result<SettingsView, ApplicationError>> {
  const bound = storeFor(deps, context, "updateSettings");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  return committed(store, async () => {
    const current = await store.settings();
    const snapshot = await deps.catalog.snapshot();
    if (!snapshot.ok) {
      return snapshot;
    }
    const before = current?.value ?? DEFAULT_SETTINGS;
    const decided = decideSettings(before, patch, snapshot.value.topics);
    if (!decided.ok) {
      return decided;
    }
    const { settings, removedFocus } = decided.value;
    const writes: Write[] = [[{ type: "settings", value: settings }, current]];
    let completedToday = false;
    if (patch.dailySize !== undefined && patch.dailySize !== before.dailySize) {
      const load = await loadPractice(store, deps.catalog, context, settings);
      if (!load.ok) {
        return load;
      }
      const applied = await applyDailySize(store, load.value, settings, context.now);
      completedToday = applied.completed;
      writes.push(...applied.writes);
    }
    return ok({ value: { settings, removedFocus, completedToday }, writes });
  });
}
