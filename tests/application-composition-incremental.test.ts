import { describe, expect, it } from "vitest";
import {
  home,
  records,
  recordAnswers,
  finishRound,
  rebuildCompositionReadModel,
  type Commit,
  type Entry,
  type LearnerStore,
} from "@instant-composition/application";
import {
  deal,
  practiceState,
  portionSize,
  seedFor,
  weaknesses,
} from "@instant-composition/domain";
import {
  FIRST_GOOD,
  makeItem,
  makeSettings,
  makeStats,
  makeRound,
  makePortion,
  makeReview,
} from "./application-fixtures";
import {
  makeHarness,
  makeSnapshot,
  fixedCatalog,
  type Harness,
} from "./application-harness";

async function ready(h: Harness): Promise<void> {
  const context = {
    ...h.context(),
    actor: {
      kind: "system" as const,
      job: "rebuild-projections" as const,
      onBehalfOf: h.learner,
    },
  };
  for (const day of ["2026-09-22", "2026-09-23"] as const) {
    for (let at = 0; at < 1000; at += 1) {
      if ((await rebuildCompositionReadModel(h.deps, context, day)).status === "ready")
        break;
      if (at === 999) throw new Error("Independent maintenance failed to finish.");
    }
  }
}
async function seed(h: Harness, noise: number): Promise<void> {
  const catalog = await h.deps.catalog.snapshot();
  if (!catalog.ok) throw new Error("The fixture catalog is unavailable.");
  const cards = [...catalog.value.shown.values()];
  const entries: Entry[] = [
    {
      type: "settings",
      value: makeSettings({
        topics: ["work", "travel"],
        newPerDay: 15,
        reviewsPerDay: 50,
      }),
    },
    {
      type: "stats",
      value: makeStats({ level: { level: 5, reason: "chosen", roundId: null, at: 0 } }),
    },
    {
      type: "round",
      value: makeRound({
        deck: cards.slice(0, 2).map(({ id }) => id),
        answerState: { firstCards: [], cursor: null, complete: true },
      }),
    },
    { type: "portion", value: makePortion({ target: 2 }) },
    { type: "streakRun", value: { schema: 1, start: "2026-09-20", end: "2026-09-21" } },
    { type: "streakRun", value: { schema: 1, start: "2026-09-23", end: "2026-09-23" } },
    ...cards.map((card, at): Entry => ({
      type: "item",
      value: makeItem({
        item: { kind: "composition", id: card.id },
        placement: { topic: card.topic, subtopic: card.subtopic },
        fsrs: {
          ...FIRST_GOOD,
          reps: 4,
          lastDay: "2026-09-21",
          dueDay: "2026-09-22",
          stability: at + 1,
        },
        last: {
          sessionId: "old",
          result: at % 2 === 0 ? "ng" : "ok",
          elapsedMs: 1000,
          answeredAt: at,
        },
      }),
    })),
    ...Array.from({ length: noise }, (_, at): Entry => ({
      type: "item",
      value: makeItem({
        item: { kind: "composition", id: `retired-${String(at)}` },
        placement: { topic: "retired", subtopic: "old" },
      }),
    })),
    ...Array.from({ length: noise }, (_, at): Entry => ({
      type: "review",
      value: makeReview({ id: `old-${String(at)}`, sessionId: "old" }),
    })),
  ];
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
  await ready(h);
}
async function parity(h: Harness): Promise<void> {
  const store = h.stores.forLearner(h.learner);
  const snapshot = await h.deps.catalog.snapshot();
  if (!snapshot.ok) throw new Error("The fixture catalog is unavailable.");
  const [items, stats, settings] = await Promise.all([
    store.items(),
    store.stats(),
    store.settings(),
  ]);
  if (stats === undefined) throw new Error("The totals fixture is unavailable.");
  for (const day of ["2026-09-22", "2026-09-23"] as const) {
    const portion = await store.portion(day);
    const tally = (await store.days([day])).get(day);
    const practice = practiceState({
      today: day,
      stats: stats.value,
      settings: settings?.value,
      cards: [...snapshot.value.shown.values()],
      items: new Map([...items].map(([id, row]) => [id, row.value])),
    });
    const size = portion?.value.target ?? portionSize(practice, 0);
    const full = deal(practice, {
      size,
      seed: seedFor(day, "today", tally?.value.roundsStarted ?? 0),
    });
    const model = await store.compositionReadModel(day);
    expect(full.ok).toBe(true);
    expect(model?.value.preview).toMatchObject({
      size,
      reviewCount: full.ok ? full.value.reviewCount : -1,
      newCount: full.ok ? full.value.newCount : -1,
      weakNames: full.ok ? full.value.weakConcepts : [],
    });
    expect(model?.value.weak).toStrictEqual(
      weaknesses({
        items: [...items.values()].map(({ value }) => value),
        shown: snapshot.value.shown,
      }),
    );
  }
}

describe("normal composition answers keep bounded projections ready", () => {
  it("preserves FSRS ties, negative legacy times and locale card-id order in primary candidate pages", async () => {
    const h = makeHarness();
    const snapshot = makeSnapshot();
    const store = h.stores.forLearner(h.learner);
    const cards = [...snapshot.shown.values()].slice(0, 6);
    await store.commit({
      puts: [
        { type: "settings", value: makeSettings() },
        ...cards.map((card, at): Entry => ({
          type: "item",
          value: makeItem({
            item: { kind: "composition", id: card.id },
            fsrs: {
              ...FIRST_GOOD,
              lastDay: "2026-09-21",
              dueDay: "2026-09-22",
              stability: 10,
            },
            last: {
              sessionId: "old",
              result: "ok",
              elapsedMs: 0,
              answeredAt: at % 2 === 0 ? -1 : 0,
            },
          }),
        })),
      ],
      updates: [],
      expect: [],
    });
    await ready(h);
    const model = await store.compositionReadModel("2026-09-22");
    if (model === undefined) throw new Error("The model is unavailable.");
    const page = await store.compositionCandidates({
      day: model.value.day,
      generation: model.value.generation,
      mode: "due",
      limit: 10,
      cursor: null,
    });
    expect(page.rows.map(({ value }) => value.id)).toStrictEqual(
      cards
        .map((card, at) => ({ id: card.id, at: at % 2 === 0 ? -1 : 0 }))
        .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
        .map(({ id }) => id),
    );
  });
  it("updates both days with two grammar tags, retry guards, exact preview/weakness, and history-independent rows", async () => {
    const counts: { rows: number; calls: number; actions: number; bytes: number }[] =
      [];
    for (const noise of [0, 1200]) {
      const original = makeSnapshot({ concepts: ["en:grammar/a", "en:grammar/b"] });
      const snapshot = {
        ...original,
        shown: new Map(
          [...original.shown].map(([id, card]) => [
            id,
            { ...card, concepts: ["en:grammar/a", "en:grammar/b"] },
          ]),
        ),
      };
      const h = makeHarness(fixedCatalog(snapshot));
      await seed(h, noise);
      const count = { rows: 0, calls: 0, actions: 0, bytes: 0 };
      const raw = h.stores.forLearner(h.learner);
      let raced = false;
      const store: LearnerStore = {
        ...raw,
        items: () =>
          Promise.reject(new Error("The answer/GET path read all progress.")),
        compositionItemsPage: () =>
          Promise.reject(new Error("The answer/GET path rebuilt.")),
        reviews: () => Promise.reject(new Error("The answer/GET path read history.")),
        reviewsOf: () =>
          Promise.reject(new Error("The answer/GET path read round history.")),
        reviewPage: () =>
          Promise.reject(new Error("A prepared round required legacy traversal.")),
        async itemsByIds(ids) {
          count.calls += 1;
          const rows = await raw.itemsByIds(ids);
          count.rows += rows.size;
          return rows;
        },
        async compositionCandidates(request) {
          count.calls += 1;
          const page = await raw.compositionCandidates(request);
          count.rows += page.rows.length;
          return page;
        },
        async compositionCandidatesByKeys(keys) {
          count.calls += 1;
          const rows = await raw.compositionCandidatesByKeys(keys);
          count.rows += rows.size;
          return rows;
        },
        async commit(commit: Commit) {
          const actions =
            commit.puts.length +
            commit.updates.length +
            commit.expect.length +
            (commit.deletes?.length ?? 0) +
            1;
          count.actions = Math.max(count.actions, actions);
          count.bytes = Math.max(
            count.bytes,
            Buffer.byteLength(JSON.stringify(commit), "utf8"),
          );
          // A conflict retries the complete source/model CAS transaction, without invalidating a ready source.
          if (!raced) {
            raced = true;
            return { ok: false, error: { code: "ERR_CONFLICT" } };
          }
          return raw.commit(commit);
        },
      };
      const deps = { ...h.deps, stores: { forLearner: () => store } };
      const command = {
        roundId: "r1",
        answers: [...snapshot.shown.values()].slice(0, 2).map((card, at) => ({
          id: `a-${String(at)}`,
          roundId: "r1",
          cardId: card.id,
          pass: "first" as const,
          result: "ok" as const,
          elapsedMs: 1000,
        })),
      };
      expect((await recordAnswers(deps, h.context(), command)).ok).toBe(true);
      expect((await home(deps, h.context())).ok).toBe(true);
      expect((await records(deps, h.context())).ok).toBe(true);
      const retry = {
        ...command,
        answers: command.answers.map((answer) => ({
          ...answer,
          id: `retry-${answer.id}`,
          pass: "retry" as const,
        })),
      };
      expect((await recordAnswers(deps, h.context(), retry)).ok).toBe(true);
      expect((await home(deps, h.context())).ok).toBe(true);
      expect((await records(deps, h.context())).ok).toBe(true);
      await parity(h);
      expect(count.actions).toBeLessThanOrEqual(21);
      expect(count.bytes).toBeLessThan(4 * 1024 * 1024);
      expect(
        (await finishRound(h.deps, h.context(), { roundId: "r1", answers: [] })).ok,
      ).toBe(true);
      expect((await home(deps, h.context())).ok).toBe(true);
      expect((await records(deps, h.context())).ok).toBe(true);
      expect((await raw.stats())?.value.streak).toStrictEqual({
        schema: 1,
        longest: 4,
      });
      expect(
        (await raw.streakNeighbours("2026-09-22")).map(({ value }) => value),
      ).toStrictEqual([{ schema: 1, start: "2026-09-20", end: "2026-09-23" }]);
      counts.push(count);
    }
    expect(
      counts.map(({ rows, calls, actions }) => ({ rows, calls, actions })),
    ).toStrictEqual([
      { rows: 182, calls: 17, actions: 19 },
      { rows: 182, calls: 17, actions: 19 },
    ]);
  });

  it("rejects expired candidates logically and rebuilds independently before publishing a fresh generation", async () => {
    const h = makeHarness();
    await seed(h, 0);
    const store = h.stores.forLearner(h.learner);
    const model = await store.compositionReadModel("2026-09-22");
    if (model === undefined) throw new Error("The projection is unavailable.");
    await store.commit({
      puts: [],
      updates: [
        {
          entry: {
            type: "compositionReadModel",
            value: { ...model.value, expiresAt: Math.floor(h.context().now / 1000) },
          },
          version: model.version,
        },
      ],
      expect: [],
    });
    expect(await home(h.deps, h.context())).toStrictEqual({
      ok: false,
      error: { code: "ERR_READ_MODEL_NOT_READY" },
    });
    // Expire the checkpoint too, so candidate TTL removal cannot be repaired by republishing its old generation.
    const build = await store.compositionBuild("2026-09-22");
    if (build === undefined) throw new Error("The checkpoint is unavailable.");
    await store.commit({
      puts: [],
      updates: [
        {
          entry: {
            type: "compositionBuild",
            value: { ...build.value, expiresAt: Math.floor(h.context().now / 1000) },
          },
          version: build.version,
        },
      ],
      expect: [],
    });
    await ready(h);
    expect((await home(h.deps, h.context())).ok).toBe(true);
    expect((await store.compositionReadModel("2026-09-22"))?.value.generation).not.toBe(
      model.value.generation,
    );
  });
});
