import { describe, expect, it } from "vitest";
import {
  home,
  records,
  rebuildCompositionReadModel,
  compositionReadModelsReady,
  type Entry,
  type LearnerStore,
  type LearnerStores,
  type RequestContext,
} from "@instant-composition/application";
import {
  addDays,
  deal,
  estimateMinutes,
  portionSize,
  practiceState,
  seedFor,
  wantedToday,
  weaknesses,
  type ItemProgress,
} from "@instant-composition/domain";
import {
  makeDay,
  makeItem,
  makePortion,
  makeSettings,
  makeStats,
  FIRST_GOOD,
} from "./application-fixtures";
import {
  fixedCatalog,
  makeHarness,
  makeSnapshot,
  type Harness,
} from "./application-harness";
import { settleComposition } from "./composition-maintenance-harness";

async function put(h: Harness, entries: readonly Entry[]): Promise<void> {
  const store = h.stores.forLearner(h.learner);
  for (let at = 0; at < entries.length; at += 80)
    expect(
      (
        await store.commit({
          puts: entries.slice(at, at + 80),
          updates: [],
          expect: [],
        })
      ).ok,
    ).toBe(true);
}
function progress(h: Harness): ItemProgress[] {
  const snapshot = makeSnapshot();
  return [...snapshot.shown.values()].slice(0, 70).map((card, at) =>
    makeItem({
      item: { kind: "composition", id: card.id },
      placement: { topic: card.topic, subtopic: card.subtopic },
      fsrs: {
        ...FIRST_GOOD,
        reps: 4,
        lastDay: "2026-09-21",
        dueDay: at % 3 === 0 ? "2026-09-24" : "2026-09-22",
        stability: at + 1,
      },
      mastered: at % 4 === 0 ? { day: "2026-09-20", sessionId: "old" } : null,
      last: {
        sessionId: "old",
        result: at % 2 === 0 ? "ng" : "ok",
        elapsedMs: 1000,
        answeredAt: h.context().now + at,
      },
    }),
  );
}
function worker(context: RequestContext): RequestContext {
  return {
    ...context,
    actor: {
      kind: "system",
      onBehalfOf: context.learner.id,
      job: "rebuild-projections",
    },
  };
}
function bounded(
  stores: LearnerStores,
  count: { rows: number; calls: number },
): LearnerStores {
  return {
    forLearner(id) {
      const store = stores.forLearner(id);
      const protectedStore: LearnerStore = {
        ...store,
        items: () => Promise.reject(new Error("An all-progress screen read.")),
        compositionItemsPage: () =>
          Promise.reject(new Error("A maintenance traversal inside GET.")),
        commit: () => Promise.reject(new Error("A GET committed.")),
        async portionsPage(range) {
          count.calls += 1;
          const page = await store.portionsPage(range);
          count.rows += page.entries.length;
          return page;
        },
        async streakNeighbours(day) {
          count.calls += 1;
          const runs = await store.streakNeighbours(day);
          count.rows += runs.length;
          return runs;
        },
      };
      return protectedStore;
    },
  };
}

describe("composition screen read models", () => {
  it.each([10, 50, null] as const)(
    "matches the full planner with a review limit of %s, including fresh selection",
    async (reviewsPerDay) => {
      const h = makeHarness();
      const items = progress(h);
      const settings = makeSettings({
        topics: ["work", "travel"],
        focus: [{ topic: "travel", subtopic: "a" }],
        newPerDay: 15,
        reviewsPerDay,
      });
      const stats = makeStats({
        level: { level: 5, reason: "chosen", roundId: null, at: 0 },
      });
      await put(h, [
        { type: "settings", value: settings },
        { type: "stats", value: stats },
        { type: "day", value: makeDay({ roundsStarted: 7 }) },
        ...items.map((value): Entry => ({ type: "item", value })),
      ]);
      await settleComposition(h.deps, h.context());
      const snapshot = makeSnapshot();
      const practice = practiceState({
        today: "2026-09-22",
        stats,
        settings,
        cards: [...snapshot.shown.values()],
        items: new Map(items.map((item) => [item.item.id, item])),
      });
      const size = portionSize(practice, 0);
      const full = deal(practice, { size, seed: seedFor(practice.today, "today", 7) });
      const read = await home(
        { ...h.deps, stores: bounded(h.stores, { rows: 0, calls: 0 }) },
        h.context(),
      );
      expect(full.ok).toBe(true);
      expect(read.ok && read.value.preview).toMatchObject({
        size,
        setting: wantedToday(practice),
        reviewCount: full.ok ? full.value.reviewCount : -1,
        newCount: full.ok ? full.value.newCount : -1,
        weakNames: full.ok
          ? full.value.weakConcepts.map(
              (concept) => snapshot.conceptNames.get(concept) ?? concept,
            )
          : [],
        minutes: estimateMinutes(size, practice.limitSeconds),
      });
      const view = await records(h.deps, h.context());
      const weak = weaknesses({ items, shown: snapshot.shown });
      expect(view.ok && view.value.weak.grammar.map(({ id }) => id)).toStrictEqual(
        weak.grammar.map(({ concept }) => concept),
      );
      expect(view.ok && view.value.reach.pending).toBe(
        items.filter((item) => item.mastered === null && item.okDays.length === 1)
          .length,
      );
    },
  );

  it("keeps GET row and call counts fixed as unrelated progress and history grow", async () => {
    const results: { rows: number; calls: number }[] = [];
    for (const noise of [0, 1200]) {
      const h = makeHarness();
      await put(h, [
        { type: "settings", value: makeSettings() },
        {
          type: "stats",
          value: makeStats({
            level: { level: 5, reason: "chosen", roundId: null, at: 0 },
          }),
        },
        ...Array.from({ length: noise }, (_, at): Entry => ({
          type: "item",
          value: makeItem({
            item: { kind: "composition", id: `retired-${String(at)}` },
            placement: { topic: "retired", subtopic: "old" },
          }),
        })),
        ...Array.from({ length: noise }, (_, at): Entry => ({
          type: "portion",
          value: makePortion({ day: addDays("2000-01-01", at), completedAt: 1 }),
        })),
      ]);
      await settleComposition(h.deps, h.context());
      const count = { rows: 0, calls: 0 };
      const deps = { ...h.deps, stores: bounded(h.stores, count) };
      expect((await home(deps, h.context())).ok).toBe(true);
      expect((await records(deps, h.context())).ok).toBe(true);
      results.push(count);
    }
    expect(results[1]).toStrictEqual(results[0]);
  });

  it("exposes readiness after source/settings/catalog changes and rebuilds outside GET", async () => {
    const h = makeHarness();
    await put(h, [
      { type: "settings", value: makeSettings() },
      {
        type: "stats",
        value: makeStats({
          level: { level: 5, reason: "chosen", roundId: null, at: 0 },
        }),
      },
    ]);
    expect(await home(h.deps, h.context())).toStrictEqual({
      ok: false,
      error: { code: "ERR_READ_MODEL_NOT_READY" },
    });
    await settleComposition(h.deps, h.context());
    await put(h, [
      {
        type: "item",
        value: makeItem({ item: { kind: "composition", id: "work-a-5-0" } }),
      },
    ]);
    expect(await records(h.deps, h.context())).toStrictEqual({
      ok: false,
      error: { code: "ERR_READ_MODEL_NOT_READY" },
    });
    await settleComposition(h.deps, h.context());
    const changed = {
      ...h.deps,
      catalog: fixedCatalog({ ...makeSnapshot(), version: "next" }),
    };
    expect(await home(changed, h.context())).toStrictEqual({
      ok: false,
      error: { code: "ERR_READ_MODEL_NOT_READY" },
    });
    await settleComposition(changed, h.context());
    expect((await home(changed, h.context())).ok).toBe(true);
  });

  it("migrates legacy completed days through portion pages before activating compact exact streaks", async () => {
    const h = makeHarness();
    const completedDays = Array.from({ length: 160 }, (_, at) =>
      addDays("2026-04-16", at),
    );
    const { streak: _compact, ...legacy } = makeStats({
      firstDay: completedDays[0] ?? null,
    });
    expect(_compact).toStrictEqual({ schema: 1, longest: 0 });
    await put(h, [
      { type: "settings", value: makeSettings() },
      { type: "stats", value: { ...legacy, completedDays } },
      ...completedDays.map((day): Entry => ({
        type: "portion",
        value: makePortion({ day, completedAt: 1 }),
      })),
    ]);
    expect(await records(h.deps, h.context())).toStrictEqual({
      ok: false,
      error: { code: "ERR_READ_MODEL_NOT_READY" },
    });
    await settleComposition(h.deps, h.context());
    const stats = (await h.stores.forLearner(h.learner).stats())?.value;
    expect(stats).not.toHaveProperty("completedDays");
    expect(stats?.streak).toStrictEqual({ schema: 1, longest: 160 });
    expect(
      (await h.stores.forLearner(h.learner).streakNeighbours("2026-09-22")).map(
        ({ value }) => value,
      ),
    ).toStrictEqual([{ schema: 1, start: "2026-04-16", end: "2026-09-22" }]);
    const view = await records(h.deps, h.context());
    expect(view.ok && view.value.streak).toStrictEqual({ current: 160, longest: 160 });
  });

  it("backfills array-only legacy credits and restarts a changed legacy checkpoint in bounded steps", async () => {
    const h = makeHarness();
    const { streak: _compact, ...legacy } = makeStats();
    expect(_compact).toStrictEqual({ schema: 1, longest: 0 });
    await put(h, [
      { type: "settings", value: makeSettings() },
      {
        type: "stats",
        value: { ...legacy, completedDays: ["2026-09-20", "2026-09-21"] },
      },
    ]);
    const store = h.stores.forLearner(h.learner);
    const first = await store.stats();
    expect(first).toBeDefined();
    await put(h, [
      {
        type: "streakRun",
        value: { schema: 1, start: "2026-09-20", end: "2026-09-20" },
      },
      {
        type: "streakMigration",
        value: {
          schema: 1,
          statsVersion: first?.version ?? 0,
          legacyCursor: null,
          cursor: null,
          open: null,
          longest: 1,
        },
      },
    ]);
    if (first === undefined) throw new Error("The legacy stats fixture is missing.");
    expect(
      (
        await store.commit({
          puts: [],
          updates: [
            {
              entry: {
                type: "stats",
                value: {
                  ...first.value,
                  completedDays: ["2026-09-20", "2026-09-21", "2026-09-22"],
                },
              },
              version: first.version,
            },
          ],
          expect: [],
        })
      ).ok,
    ).toBe(true);
    await settleComposition(h.deps, h.context());
    expect((await store.stats())?.value.streak).toStrictEqual({
      schema: 1,
      longest: 3,
    });
    expect(await store.streakMigration()).toBeUndefined();
    expect(
      (
        await store.portionsPage({ from: "2026-09-20", to: "2026-09-22", limit: 3 })
      ).entries.map(({ value }) => value),
    ).toStrictEqual(
      ["2026-09-20", "2026-09-21", "2026-09-22"].map((day) => ({
        day,
        target: 0,
        progress: 0,
        completedAt: 0,
        completedRound: "legacy-migration",
      })),
    );
  });

  it.each([1, 3, 12, 70, 150])(
    "matches full preview ordering for an existing %s-card portion, including top-ups beyond five cards",
    async (size) => {
      const snapshot = makeSnapshot({
        concepts: ["en:grammar/a", "en:grammar/b", "en:grammar/c"],
      });
      const h = makeHarness(fixedCatalog(snapshot));
      const settings = makeSettings({
        topics: ["work", "travel"],
        newPerDay: 15,
        reviewsPerDay: null,
      });
      const stats = makeStats({
        level: { level: 5, reason: "chosen", roundId: null, at: 0 },
      });
      const items = [...snapshot.shown.values()].map((card, at) =>
        makeItem({
          item: { kind: "composition", id: card.id },
          placement: { topic: card.topic, subtopic: card.subtopic },
          fsrs: {
            ...FIRST_GOOD,
            reps: 4,
            lastDay: "2026-09-21",
            dueDay: "2026-09-24",
            stability: at + 1,
          },
          last: {
            sessionId: "old",
            result: at % 3 === 1 ? "ng" : "ok",
            elapsedMs: 1000,
            answeredAt: h.context().now + at,
          },
        }),
      );
      await put(h, [
        { type: "settings", value: settings },
        { type: "stats", value: stats },
        { type: "portion", value: makePortion({ target: size }) },
        ...items.map((value): Entry => ({ type: "item", value })),
      ]);
      await settleComposition(h.deps, h.context());
      const practice = practiceState({
        today: "2026-09-22",
        stats,
        settings,
        cards: [...snapshot.shown.values()],
        items: new Map(items.map((item) => [item.item.id, item])),
      });
      const full = deal(practice, { size, seed: seedFor(practice.today, "today", 0) });
      const read = await home(h.deps, h.context());
      expect(full.ok).toBe(true);
      expect(read.ok && read.value.preview).toMatchObject({
        size,
        reviewCount: full.ok ? full.value.reviewCount : -1,
        newCount: 0,
        weakNames: full.ok ? full.value.weakConcepts : [],
      });
    },
  );

  it("rejects publication raced by a source mutation and prepares tomorrow independently", async () => {
    const h = makeHarness();
    await put(h, [
      { type: "settings", value: makeSettings() },
      { type: "stats", value: makeStats() },
    ]);
    let raced = false;
    const store = h.stores.forLearner(h.learner);
    const deps = {
      ...h.deps,
      stores: {
        forLearner() {
          return {
            ...store,
            async commit(commit) {
              if (
                !raced &&
                commit.puts.some((entry) => entry.type === "compositionReadModel")
              ) {
                raced = true;
                await store.commit({
                  puts: [{ type: "item", value: makeItem() }],
                  updates: [],
                  expect: [],
                });
              }
              return store.commit(commit);
            },
          } satisfies LearnerStore;
        },
      },
    };
    await settleComposition(deps, h.context());
    expect(raced).toBe(true);
    const source = await store.compositionSource();
    expect((await store.compositionReadModel("2026-09-22"))?.value.epoch).toBe(
      source?.value.epoch,
    );
    const next = h.context(h.context().now + 86_400_000);
    expect(await compositionReadModelsReady(h.deps, worker(h.context()))).toBe(false);
    expect(await home(h.deps, next)).toStrictEqual({
      ok: false,
      error: { code: "ERR_READ_MODEL_NOT_READY" },
    });
    for (let step = 0; step < 10; step += 1) {
      const result = await rebuildCompositionReadModel(
        h.deps,
        worker(h.context()),
        "2026-09-23",
      );
      if (result.status === "ready") break;
    }
    expect((await home(h.deps, next)).ok).toBe(true);
    expect(await compositionReadModelsReady(h.deps, worker(h.context()))).toBe(true);
    await put(h, [{ type: "day", value: makeDay() }]);
    expect(await compositionReadModelsReady(h.deps, worker(h.context()))).toBe(false);
    await expect(
      rebuildCompositionReadModel(h.deps, worker(h.context()), "2026-09-24"),
    ).rejects.toThrow(RangeError);
  });

  it("retains withdrawn mastery at its current retired placement while weakness uses shown cards", async () => {
    const original = makeSnapshot();
    const withdrawn = [...original.shown.values()][0];
    if (withdrawn === undefined) throw new Error("The shown catalog fixture is empty.");
    const shown = new Map(original.shown);
    shown.delete(withdrawn.id);
    const snapshot = {
      ...original,
      version: "withdrawn",
      shown,
      retired: new Map([
        [
          withdrawn.id,
          {
            ...withdrawn,
            topic: "travel",
            subtopic: "b",
          },
        ],
      ]),
    };
    const h = makeHarness(fixedCatalog(snapshot));
    await put(h, [
      { type: "settings", value: makeSettings({ topics: ["work", "travel"] }) },
      { type: "stats", value: makeStats() },
      {
        type: "item",
        value: makeItem({
          item: { kind: "composition", id: withdrawn.id },
          placement: { topic: "work", subtopic: "a" },
          mastered: { day: "2026-09-20", sessionId: "old" },
          last: { sessionId: "old", result: "ng", elapsedMs: 1000, answeredAt: 1 },
        }),
      },
      {
        type: "item",
        value: makeItem({
          item: { kind: "composition", id: "historical-only" },
          placement: { topic: "work", subtopic: "a" },
          okDays: ["2026-09-20"],
        }),
      },
    ]);
    await settleComposition(h.deps, h.context());
    const view = await records(h.deps, h.context());
    expect(view.ok && view.value.reach).toMatchObject({
      pending: 1,
      topics: [
        { id: "work", count: 0 },
        { id: "travel", count: 1 },
      ],
    });
    expect(view.ok && view.value.breakdown[1]?.subtopics[1]).toMatchObject({
      id: "b",
      count: 1,
    });
    expect(view.ok && view.value.weak.grammar).toStrictEqual([]);
    expect(view.ok && view.value.weak.subtopics).toStrictEqual([]);
  });

  it("refuses worker contexts that do not carry the learner from the trusted profile", async () => {
    const h = makeHarness();
    await expect(rebuildCompositionReadModel(h.deps, h.context())).rejects.toThrow(
      RangeError,
    );
    await expect(compositionReadModelsReady(h.deps, h.context())).rejects.toThrow(
      RangeError,
    );
    await expect(
      compositionReadModelsReady(h.deps, worker(h.context()), []),
    ).rejects.toThrow(RangeError);
  });
});
