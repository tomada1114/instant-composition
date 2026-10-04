import { describe, expect, it } from "vitest";

import {
  finishRound,
  recordAnswers,
  startRound,
  updateSettings,
  vocabHub,
  startVocabSession,
  startPagedVocabSession,
  preparePagedVocabSession,
  getPagedVocabPage,
  finishVocabSession,
  rebuildVocabReadModel,
  type LearnerStore,
  type LearnerStores,
} from "@instant-composition/application";
import {
  planVocab,
  DEFAULT_SETTINGS,
  withDefaults,
  replayItems,
} from "@instant-composition/domain";
import { prepareVocabReadModels } from "./read-model-harness";
import {
  makePersonalCard,
  makeStats,
  makeRound,
  makeVocabProgress,
} from "./application-fixtures";
import { describeBoundedAnswerContract } from "./bounded-answer-contract";
import { describeFirstAnswerContract } from "./first-answer-contract";

import {
  answersFor,
  fixedCatalog,
  makeSnapshot,
  vocabItem,
  DAY_MS,
  makeHarness,
  NOON,
  type Harness,
} from "./application-harness";

describeBoundedAnswerContract(
  "application-projections.test.ts",
  () => makeHarness().stores,
);
describeFirstAnswerContract("first answers with memory", () => makeHarness().stores);

/** A placement, then five days of rounds with misses, retries and fast answers. */
async function fiveDays(h: Harness): Promise<void> {
  await updateSettings(h.deps, h.context(), { topics: ["work", "travel"] });
  const placement = await startRound(h.deps, h.context(), {
    kind: "placement",
    roundId: "p1",
  });
  if (!placement.ok) throw new Error(placement.error.code);
  await finishRound(h.deps, h.context(), {
    roundId: "p1",
    answers: answersFor(placement.value, (_, index) => (index < 5 ? "ok" : "ng")),
  });
  for (let day = 1; day <= 5; day += 1) {
    const now = NOON + day * DAY_MS;
    const started = await startRound(h.deps, h.context(now), {
      kind: "today",
      roundId: `t${String(day)}`,
    });
    if (!started.ok) throw new Error(started.error.code);
    const round = started.value;
    const firsts = answersFor(
      round,
      (_, index) => ((index + day) % 3 === 0 ? "ng" : "ok"),
      1_000 * day,
    );
    await recordAnswers(h.deps, h.context(now), {
      roundId: round.id,
      answers: firsts.slice(0, 4),
    });
    const retries = firsts
      .filter((answer) => answer.result === "ng")
      .map((answer) => ({
        ...answer,
        id: `${round.id}:r:${answer.cardId}`,
        pass: "retry" as const,
        result: "ok" as const,
      }));
    await finishRound(h.deps, h.context(now + 60_000), {
      roundId: round.id,
      answers: [...firsts.slice(4), ...retries],
    });
  }
}

/**
 * Day 1's round is left with its answers queued, day 2's round answers some of
 * the same cards, and then day 1's answers arrive, stamped with day 1's times.
 */
async function lateArrival(h: Harness): Promise<void> {
  await updateSettings(h.deps, h.context(), { topics: ["work", "travel"] });
  const placement = await startRound(h.deps, h.context(), {
    kind: "placement",
    roundId: "p1",
  });
  if (!placement.ok) throw new Error(placement.error.code);
  await finishRound(h.deps, h.context(), {
    roundId: "p1",
    answers: answersFor(placement.value),
  });
  const early = await startRound(h.deps, h.context(NOON + DAY_MS), {
    kind: "today",
    roundId: "t1",
  });
  const later = await startRound(h.deps, h.context(NOON + 2 * DAY_MS), {
    kind: "today",
    roundId: "t2",
  });
  if (!early.ok || !later.ok) throw new Error("A round did not start.");
  await finishRound(h.deps, h.context(NOON + 2 * DAY_MS + 60_000), {
    roundId: later.value.id,
    answers: answersFor(later.value, (_, index) => (index % 2 === 0 ? "ok" : "ng")),
  });
  await recordAnswers(h.deps, h.context(NOON + 2 * DAY_MS + 120_000), {
    roundId: early.value.id,
    answers: answersFor(early.value, (_, index) => (index % 3 === 0 ? "ng" : "ok")).map(
      (answer, index) => ({ ...answer, answeredAt: NOON + DAY_MS + index * 1_000 }),
    ),
  });
}

describe("the projections a command keeps", () => {
  it("replays two committed state changes in arrival order when their client times are reversed", async () => {
    const h = makeHarness();
    const store = h.stores.forLearner(h.learner);
    const cardId = "work-a-5-0";
    await store.commit({
      puts: [
        {
          type: "round",
          value: makeRound({
            id: "old",
            deck: [cardId],
            startedAt: NOON,
            abandonedAt: NOON + DAY_MS,
          }),
        },
        {
          type: "round",
          value: makeRound({
            id: "new",
            day: "2026-09-23",
            portionDay: "2026-09-23",
            deck: [cardId],
            startedAt: NOON + DAY_MS,
          }),
        },
      ],
      updates: [],
      expect: [],
    });
    const first = await recordAnswers(h.deps, h.context(NOON + DAY_MS + 120_000), {
      roundId: "old",
      answers: [
        {
          id: "old-answer",
          cardId,
          roundId: "old",
          pass: "first",
          result: "ok",
          elapsedMs: 1_000,
          answeredAt: NOON + DAY_MS + 60_000,
        },
      ],
    });
    const second = await recordAnswers(h.deps, h.context(NOON + DAY_MS + 180_000), {
      roundId: "new",
      answers: [
        {
          id: "new-answer",
          cardId,
          roundId: "new",
          pass: "first",
          result: "ok",
          elapsedMs: 1_000,
          answeredAt: NOON + DAY_MS + 30_000,
        },
      ],
    });
    const log = await store.reviews();
    const item = (await store.items()).get(cardId)?.value;

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(log.map((entry) => entry.revision)).toStrictEqual([2, 1]);
    expect(item).toMatchObject({ revision: 2, fsrs: { reps: 2 } });
    expect(replayItems(log).get(cardId)).toStrictEqual(item);
  });

  it("equal what replaying the review log rebuilds when a round's answers arrive late", async () => {
    const h = makeHarness();
    await lateArrival(h);
    const store = h.stores.forLearner(h.learner);
    const log = await store.reviews();
    const items = new Map(
      [...(await store.items())].map(([id, stored]) => [id, stored.value]),
    );

    expect(log.some((entry) => entry.sessionId === "t1")).toBe(true);
    expect(items).toStrictEqual(replayItems(log));
  });

  it("equal what replaying the review log rebuilds", async () => {
    const h = makeHarness();
    await fiveDays(h);
    const store = h.stores.forLearner(h.learner);
    const log = await store.reviews();
    const items = new Map(
      [...(await store.items())].map(([id, stored]) => [id, stored.value]),
    );

    expect(log.length).toBeGreaterThan(50);
    expect([...items.values()].some((item) => item.mastered !== null)).toBe(true);
    expect(items).toStrictEqual(replayItems(log));
  });

  it("keep the learner's totals and each day's tally in step with the log", async () => {
    const h = makeHarness();
    await fiveDays(h);
    const store = h.stores.forLearner(h.learner);
    const log = await store.reviews();
    const days = [...new Set(log.map((entry) => entry.day))].sort();
    const stats = (await store.stats())?.value;
    const tallies = await store.days(days);

    expect(stats?.said).toBe(log.length);
    expect(stats?.practicedDays).toBe(days.length);
    expect(stats?.firstDay).toBe(days[0]);
    for (const day of days) {
      const onDay = log.filter((entry) => entry.day === day);
      expect(tallies.get(day)?.value).toMatchObject({
        answers: onDay.length,
        firstPass: onDay.filter((entry) => entry.detail.pass === "first").length,
      });
    }
  });
});

/** Stores whose next `losses` commits each lose a race to another write of the stats. */
function racing(inner: LearnerStores, losses: number): LearnerStores {
  let left = losses;
  return {
    forLearner(id) {
      const store = inner.forLearner(id);
      const raced: LearnerStore = {
        ...store,
        async commit(commit) {
          if (left > 0) {
            left -= 1;
            const stats = await store.stats();
            if (stats !== undefined) {
              await store.commit({
                puts: [],
                updates: [
                  {
                    entry: { type: "stats", value: stats.value },
                    version: stats.version,
                  },
                ],
                expect: [],
              });
            }
          }
          return store.commit(commit);
        },
      };
      return raced;
    },
  };
}

describe("a command that loses a race", () => {
  async function ready(): Promise<Harness> {
    const h = makeHarness();
    await updateSettings(h.deps, h.context(), { topics: ["work"] });
    const started = await startRound(h.deps, h.context(), {
      kind: "placement",
      roundId: "p1",
    });
    if (!started.ok) throw new Error(started.error.code);
    return h;
  }

  it("loads, decides and commits again", async () => {
    const h = await ready();
    const deps = { ...h.deps, stores: racing(h.stores, 2) };
    const round = await h.stores.forLearner(h.learner).round("p1");

    const recorded = await recordAnswers(deps, h.context(), {
      roundId: "p1",
      answers: (round?.value.deck ?? []).slice(0, 3).map((cardId) => ({
        id: `p1:f:${cardId}`,
        roundId: "p1",
        cardId,
        pass: "first" as const,
        result: "ok" as const,
        elapsedMs: 1_000,
      })),
    });

    expect(recorded.ok).toBe(true);
    expect(await h.stores.forLearner(h.learner).reviewsOf("p1")).toHaveLength(3);
  });

  it("answers ERR_CONFLICT once it has lost every attempt", async () => {
    const h = await ready();
    const deps = { ...h.deps, stores: racing(h.stores, 10) };

    expect(
      await startRound(deps, h.context(), { kind: "extra", roundId: "e1" }),
    ).toStrictEqual({
      ok: false,
      error: { code: "ERR_CONFLICT" },
    });
  });
});

describe("bounded vocabulary read models", () => {
  it("keeps missing and unfinished generations out of foreground reads", async () => {
    const h = makeHarness();
    expect(await vocabHub(h.deps, h.context())).toStrictEqual({
      ok: false,
      error: { code: "ERR_READ_MODEL_NOT_READY" },
    });
    const context = h.context();
    const worker = {
      ...context,
      actor: {
        kind: "system" as const,
        job: "rebuild-projections" as const,
        onBehalfOf: h.learner,
      },
    };
    const step = await rebuildVocabReadModel(h.deps, worker);
    expect(step.ok && step.value).toMatchObject({ status: "building", rows: 10 });
    expect(await vocabHub(h.deps, context)).toStrictEqual({
      ok: false,
      error: { code: "ERR_READ_MODEL_NOT_READY" },
    });
    await prepareVocabReadModels(h.deps, context);
    expect((await vocabHub(h.deps, context)).ok).toBe(true);
  });

  it("matches the pure full calculation and incrementally maintains both prepared days", async () => {
    const h = makeHarness();
    await prepareVocabReadModels(h.deps, h.context());
    const session = await startVocabSession(h.deps, h.context(), {
      sessionId: "bounded",
      kind: "today",
    });
    if (!session.ok) throw new Error(session.error.code);
    await finishVocabSession(h.deps, h.context(), {
      sessionId: "bounded",
      answers: session.value.cards.map((card) => ({
        id: `a:${card.id}`,
        cardId: card.id,
        pass: "first",
        grade: "good",
        elapsedMs: 1_000,
      })),
    });
    const store = h.stores.forLearner(h.learner);
    const snapshot = await h.deps.catalog.snapshot();
    if (!snapshot.ok) throw new Error(snapshot.error.code);
    const items = await store.vocabItems();
    const limits = withDefaults(DEFAULT_SETTINGS);
    for (const [now, day] of [
      [NOON, "2026-09-22"],
      [NOON + DAY_MS, "2026-09-23"],
    ] as const) {
      const pure = planVocab({
        today: day,
        level: 1,
        cards: [...snapshot.value.vocab.values()],
        progress: new Map([...items].map(([id, stored]) => [id, stored.value])),
        newPerDay: limits.vocabNewPerDay,
        reviewsPerDay: limits.vocabReviewsPerDay,
      });
      const projected = await vocabHub(h.deps, h.context(now));
      expect(projected.ok && projected.value).toMatchObject({
        today: {
          due: pure.figures.due,
          new: pure.figures.fresh,
          minutes: pure.figures.minutes,
        },
        extra: pure.deal("extra", null).length,
        weak: pure.deal("weak", null).length,
        tomorrow: pure.figures.tomorrow,
      });
      expect(projected.ok && projected.value.categories).toStrictEqual(
        pure.figures.categories.map(({ category, due, fresh, learning, total }) => ({
          category,
          due,
          new: fresh,
          learning,
          total,
          extra: pure.deal("extra", category).length,
          weak: pure.deal("weak", category).length,
        })),
      );
    }
  });

  it("restarts a paged build when a source commit wins before activation", async () => {
    const h = makeHarness();
    const context = h.context();
    const worker = {
      ...context,
      actor: {
        kind: "system" as const,
        job: "rebuild-projections" as const,
        onBehalfOf: h.learner,
      },
    };
    await rebuildVocabReadModel(h.deps, worker);
    await h.stores.forLearner(h.learner).commit({
      puts: [{ type: "vocabItem", value: makeVocabProgress() }],
      updates: [],
      expect: [],
    });
    const next = await rebuildVocabReadModel(h.deps, worker);
    expect(next.ok && next.value.status).toBe("restarted");
    await prepareVocabReadModels(h.deps, context);
    expect((await vocabHub(h.deps, context)).ok).toBe(true);
  });
});

describe("vocabulary query row bounds", () => {
  async function populated(count: number) {
    const h = makeHarness();
    const store = h.stores.forLearner(h.learner);
    const categories = ["word", "idiom", "phrasal-verb", "phrase"] as const;
    for (let offset = 0; offset < count; offset += 40) {
      const values = Array.from({ length: Math.min(40, count - offset) }, (_, index) =>
        makePersonalCard({
          id: `p_${String(offset + index).padStart(12, "0")}`,
          category: categories[(offset + index) % 4] ?? "word",
          level: 3,
          createdAt: NOON + offset + index,
        }),
      );
      const result = await store.commit({
        puts: values.map((value) => ({ type: "card", value })),
        updates: [],
        expect: [],
      });
      if (!result.ok) throw new Error(result.error.code);
    }
    await prepareVocabReadModels(h.deps, h.context());
    return h;
  }
  async function measured(h: Harness) {
    let rows = 0;
    let pages = 0;
    const stores: LearnerStores = {
      forLearner(id) {
        const store = h.stores.forLearner(id);
        return {
          ...store,
          async vocabCandidates(request) {
            const result = await store.vocabCandidates(request);
            rows += result.rows.length;
            pages += 1;
            return result;
          },
          items() {
            throw new Error("Foreground progress scan.");
          },
          vocabItems() {
            throw new Error("Foreground vocabulary scan.");
          },
          cards() {
            throw new Error("Foreground personal-card scan.");
          },
          personalCardPage() {
            throw new Error("Foreground maintenance page.");
          },
        };
      },
    };
    const result = await vocabHub({ ...h.deps, stores }, h.context());
    expect(result.ok).toBe(true);
    const deps = { ...h.deps, stores };
    const session = await startVocabSession(deps, h.context(), {
      sessionId: "normal",
      kind: "today",
    });
    if (!session.ok) throw new Error(session.error.code);
    const card = session.value.cards[0];
    if (card === undefined) throw new Error("No bounded fixture card.");
    expect(
      (
        await finishVocabSession(deps, h.context(), {
          sessionId: "normal",
          answers: [
            {
              id: "normal-answer",
              cardId: card.id,
              pass: "first",
              grade: "good",
              elapsedMs: 1,
            },
          ],
        })
      ).ok,
    ).toBe(true);
    expect((await vocabHub(deps, h.context(NOON + DAY_MS))).ok).toBe(true);
    return { rows, pages };
  }
  it("returns the same fixed quota rows and pages with 200 or 1,000 personal cards", async () => {
    const small = await populated(200);
    const large = await populated(1_000);
    expect(await measured(large)).toStrictEqual(await measured(small));
    const day = (
      await large.stores.forLearner(large.learner).vocabReadModel("2026-09-22")
    )?.value;
    expect(day?.counts.reduce((total, count) => total + count.total, 0)).toBe(1_040);
    expect(JSON.stringify(day).length).toBeLessThan(2_000);
  });
});

describe("pure vocabulary projection parity", () => {
  it.each([50, 100, 200, null] as const)(
    "preserves every deal/category at review limit %s without rebuilding for settings",
    async (limit) => {
      const categories = ["word", "idiom", "phrasal-verb", "phrase"] as const;
      const cards = Array.from({ length: 380 }, (_, index) => ({
        ...vocabItem(categories[index % 4] ?? "word", 1 + (index % 12), index),
        meaning: `意味${String(index)}`,
      }));
      const personal = Array.from({ length: 16 }, (_, index) =>
        makePersonalCard({
          id: `p_parity${String(index).padStart(6, "0")}`,
          category: categories[index % 4] ?? "word",
          level: 11 + (index % 3),
          createdAt: 1_000,
        }),
      );
      const h = makeHarness(fixedCatalog(makeSnapshot({ vocab: cards })));
      const store = h.stores.forLearner(h.learner);
      const ordered = [...cards, ...personal];
      const progress = ordered.slice(0, 320).map((card, index) =>
        makeVocabProgress({
          cardId: card.id,
          state:
            index % 23 === 0
              ? null
              : {
                  stability: 1 + (index % 7) * 1e-12,
                  difficulty: index % 5 === 0 ? 9 : 4,
                  reps: 12,
                  lapses: index % 5 === 0 ? 8 : 0,
                  lastDay: index % 17 === 0 ? "2026-09-22" : "2026-09-18",
                  dueDay: index % 19 === 0 ? "2026-09-25" : "2026-09-20",
                },
          firstDay: index % 17 === 0 ? "2026-09-22" : "2026-09-01",
        }),
      );
      for (let offset = 0; offset < progress.length; offset += 40)
        await store.commit({
          puts: progress
            .slice(offset, offset + 40)
            .map((value) => ({ type: "vocabItem", value })),
          updates: [],
          expect: [],
        });
      await store.commit({
        puts: personal.map((value) => ({ type: "card", value })),
        updates: [],
        expect: [],
      });
      await store.commit({
        puts: [
          {
            type: "stats",
            value: makeStats({
              level: { level: 12, reason: "placement", roundId: null, at: NOON },
            }),
          },
        ],
        updates: [],
        expect: [],
      });
      await prepareVocabReadModels(h.deps, h.context());
      const before = await store.vocabReadModel("2026-09-22");
      expect(
        (
          await updateSettings(h.deps, h.context(), {
            topics: ["work"],
            vocabNewPerDay: 30,
            vocabReviewsPerDay: limit,
          })
        ).ok,
      ).toBe(true);
      expect(await store.vocabReadModel("2026-09-22")).toStrictEqual(before);
      const pure = planVocab({
        today: "2026-09-22",
        level: 12,
        cards: ordered,
        progress: new Map(progress.map((value) => [value.cardId, value])),
        newPerDay: 30,
        reviewsPerDay: limit,
      });
      if (limit === null) expect(pure.figures.due).toBeGreaterThan(250);
      const projected = await vocabHub(h.deps, h.context());
      expect(projected.ok && projected.value.today).toStrictEqual({
        due: pure.figures.due,
        new: pure.figures.fresh,
        minutes: pure.figures.minutes,
      });
      for (const kind of ["today", "extra", "weak"] as const)
        for (const category of [null, ...categories]) {
          const expected = pure.deal(kind, category).map(({ cardId }) => cardId);
          const session = await startVocabSession(h.deps, h.context(), {
            sessionId: `parity-${kind}-${category ?? "all"}`,
            kind,
            ...(category === null ? {} : { category }),
          });
          if (expected.length > 200)
            expect(session).toStrictEqual({
              ok: false,
              error: { code: "ERR_PAGED_SESSION_REQUIRED" },
            });
          else
            expect(session.ok && session.value.cards.map(({ id }) => id)).toStrictEqual(
              expected,
            );
          const sessionId = `paged-parity-${kind}-${category ?? "all"}`;
          let preparation = await startPagedVocabSession(h.deps, h.context(), {
            sessionId,
            kind,
            ...(category === null ? {} : { category }),
          });
          for (
            let step = 0;
            preparation.ok && preparation.value.status === "building" && step < 10;
            step += 1
          )
            preparation = await preparePagedVocabSession(
              h.deps,
              h.context(),
              sessionId,
            );
          expect(preparation.ok && preparation.value.status).toBe("ready");
          const actual: string[] = [];
          let cursor: string | null = null;
          for (let step = 0; step < 10; step += 1) {
            const page = await getPagedVocabPage(h.deps, h.context(), {
              sessionId,
              cursor,
            });
            if (!page.ok) throw new Error(page.error.code);
            expect(page.value.cards.length).toBeLessThanOrEqual(64);
            actual.push(...page.value.cards.map(({ id }) => id));
            cursor = page.value.continuation;
            if (cursor === null) break;
          }
          expect(cursor).toBeNull();
          expect(actual).toStrictEqual(expected);
        }
    },
  );

  it("fails closed on a new catalog, then removes withdrawn membership with orphan progress untouched", async () => {
    const h = makeHarness();
    await prepareVocabReadModels(h.deps, h.context());
    const snapshot = await h.deps.catalog.snapshot();
    if (!snapshot.ok) throw new Error(snapshot.error.code);
    const remaining = [...snapshot.value.vocab.values()].slice(1);
    const changed = {
      ...h.deps,
      catalog: fixedCatalog({
        ...makeSnapshot({ vocab: remaining }),
        version: "next-catalog",
      }),
    };
    expect(await vocabHub(changed, h.context())).toStrictEqual({
      ok: false,
      error: { code: "ERR_READ_MODEL_NOT_READY" },
    });
    await prepareVocabReadModels(changed, h.context());
    const hub = await vocabHub(changed, h.context());
    expect(
      hub.ok && hub.value.categories.reduce((sum, count) => sum + count.total, 0),
    ).toBe(39);
  });
});
