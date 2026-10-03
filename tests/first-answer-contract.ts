import { describe, expect, it } from "vitest";

import {
  finishRound,
  learnerId,
  recordAnswers,
  type ApplicationDeps,
  type LearnerStore,
  type LearnerStores,
} from "@instant-composition/application";
import type { AnswerInput } from "@instant-composition/domain";

import { makeDay, makePortion, makeRound, makeStats } from "./application-fixtures";
import { fixedCatalog, makeHarness, NOON } from "./application-harness";

const CARD = "work-a-5-0";
const h = makeHarness();

function first(id: string, grade: "good" | "again" = "good"): AnswerInput {
  return { id, roundId: "r1", cardId: CARD, pass: "first", grade, elapsedMs: 1_000 };
}

async function saved(store: LearnerStore): Promise<unknown> {
  return {
    round: await store.round("r1"),
    portion: await store.portion("2026-09-22"),
    days: await store.days(["2026-09-22"]),
    stats: await store.stats(),
    items: await store.items(),
    reviews: await store.reviewsOf("r1"),
  };
}

/** Both first transactions reach the commit before either is allowed to win. */
function racing(stores: LearnerStores): LearnerStores {
  let arrivals = 0;
  let release: () => void = () => {
    throw new Error("Commit barrier is not initialized.");
  };
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    forLearner(id) {
      const store = stores.forLearner(id);
      return {
        ...store,
        async commit(commit) {
          arrivals += 1;
          if (arrivals <= 2) {
            if (arrivals === 2) release();
            await barrier;
          }
          return store.commit(commit);
        },
      };
    },
  };
}

/** Logical first-answer uniqueness through the real command and each store adapter. */
export function describeFirstAnswerContract(
  name: string,
  makeStores: () => LearnerStores | Promise<LearnerStores>,
): void {
  async function ready(): Promise<ApplicationDeps> {
    const stores = await makeStores();
    const written = await stores.forLearner(h.learner).commit({
      puts: [
        { type: "round", value: makeRound({ deck: [CARD], startedAt: NOON }) },
        { type: "portion", value: makePortion({ target: 1 }) },
        { type: "day", value: makeDay() },
        { type: "stats", value: makeStats() },
      ],
      updates: [],
      expect: [],
    });
    if (!written.ok) throw new Error(written.error.code);
    return { stores, catalog: fixedCatalog() };
  }

  async function once(store: LearnerStore): Promise<void> {
    expect((await store.round("r1"))?.value.firstPass).toBe(1);
    expect((await store.portion("2026-09-22"))?.value.progress).toBe(1);
    expect((await store.days(["2026-09-22"])).get("2026-09-22")?.value).toMatchObject({
      answers: 1,
      firstPass: 1,
    });
    expect((await store.stats())?.value.said).toBe(1);
    expect((await store.items()).get(CARD)?.value).toMatchObject({
      revision: 1,
      fsrs: { reps: 1 },
    });
    expect(await store.reviewsOf("r1")).toHaveLength(1);
  }

  describe(`${name}: logical first answers`, () => {
    it("keeps one adopted first answer across the maximum HTTP batch's transaction chunks", async () => {
      const deps = await ready();
      const answers = Array.from({ length: 60 }, (_, index) =>
        first(
          `duplicate-${String(index).padStart(2, "0")}`,
          index === 0 ? "good" : "again",
        ),
      );
      expect(
        (await recordAnswers(deps, h.context(), { roundId: "r1", answers })).ok,
      ).toBe(true);
      const store = deps.stores.forLearner(h.learner);
      await once(store);
      expect((await store.reviewsOf("r1"))[0]).toMatchObject({
        id: "duplicate-00",
        detail: { grade: "good" },
      });
    });

    it("adopts a separate first answer for the same card in another round", async () => {
      const deps = await ready();
      const store = deps.stores.forLearner(h.learner);
      expect(
        (
          await recordAnswers(deps, h.context(), {
            roundId: "r1",
            answers: [first("one")],
          })
        ).ok,
      ).toBe(true);
      expect(
        (
          await store.commit({
            puts: [
              {
                type: "round",
                value: makeRound({ id: "r2", deck: [CARD], startedAt: NOON }),
              },
            ],
            updates: [],
            expect: [],
          })
        ).ok,
      ).toBe(true);
      expect(
        (
          await recordAnswers(deps, h.context(), {
            roundId: "r2",
            answers: [{ ...first("two", "again"), roundId: "r2" }],
          })
        ).ok,
      ).toBe(true);
      expect((await store.round("r1"))?.value.firstPass).toBe(1);
      expect((await store.round("r2"))?.value.firstPass).toBe(1);
      expect(
        (await store.days(["2026-09-22"])).get("2026-09-22")?.value.firstPass,
      ).toBe(2);
      expect((await store.reviewsOf("r2"))[0]).toMatchObject({
        id: "two",
        detail: { grade: "again" },
      });
      expect((await store.items()).get(CARD)?.value.fsrs?.reps).toBe(1);
    });

    it("adopts one of different-id first answers in a batch, preserving its grade", async () => {
      const deps = await ready();
      const result = await recordAnswers(deps, h.context(NOON + 1_000), {
        roundId: "r1",
        answers: [first("z", "again"), first("a")],
      });
      expect(result).toStrictEqual({ ok: true, value: undefined });
      const store = deps.stores.forLearner(h.learner);
      await once(store);
      expect((await store.reviewsOf("r1"))[0]).toMatchObject({
        id: "a",
        detail: { grade: "good", result: "ok" },
      });
    });

    it("accepts another request and repeated duplicates without changing the adopted result or versions", async () => {
      const deps = await ready();
      const store = deps.stores.forLearner(h.learner);
      expect(
        (
          await recordAnswers(deps, h.context(), {
            roundId: "r1",
            answers: [first("original", "again")],
          })
        ).ok,
      ).toBe(true);
      const before = await saved(store);
      for (const id of ["other", "other", "original"]) {
        expect(
          await recordAnswers(deps, h.context(NOON + 2_000), {
            roundId: "r1",
            answers: [first(id)],
          }),
        ).toStrictEqual({ ok: true, value: undefined });
      }
      expect(await saved(store)).toStrictEqual(before);
      expect((await store.reviewsOf("r1"))[0]).toMatchObject({
        id: "original",
        detail: { grade: "again", result: "ng" },
      });
      await once(store);
    });

    it("lets the first successful transaction win when two tabs race with different grades", async () => {
      const deps = await ready();
      const raced = { ...deps, stores: racing(deps.stores) };
      const results = await Promise.all([
        recordAnswers(raced, h.context(), { roundId: "r1", answers: [first("tab-a")] }),
        recordAnswers(raced, h.context(), {
          roundId: "r1",
          answers: [first("tab-b", "again")],
        }),
      ]);
      expect(results).toStrictEqual([
        { ok: true, value: undefined },
        { ok: true, value: undefined },
      ]);
      const store = deps.stores.forLearner(h.learner);
      await once(store);
      const before = await saved(store);
      expect(
        (
          await recordAnswers(deps, h.context(), {
            roundId: "r1",
            answers: [first("tab-a"), first("tab-b", "again")],
          })
        ).ok,
      ).toBe(true);
      expect(await saved(store)).toStrictEqual(before);
    });

    it("keeps recorded-id resends successful after finish while new first and retry ids remain refused", async () => {
      const deps = await ready();
      expect(
        (
          await finishRound(deps, h.context(), {
            roundId: "r1",
            answers: [first("original")],
          })
        ).ok,
      ).toBe(true);
      const store = deps.stores.forLearner(h.learner);
      const before = await saved(store);
      expect(
        (
          await recordAnswers(deps, h.context(), {
            roundId: "r1",
            answers: [first("original")],
          })
        ).ok,
      ).toBe(true);
      expect(await saved(store)).toStrictEqual(before);
      expect(
        await recordAnswers(deps, h.context(), {
          roundId: "r1",
          answers: [first("other", "again")],
        }),
      ).toStrictEqual({ ok: false, error: { code: "ERR_ROUND_CLOSED" } });
      expect(
        await recordAnswers(deps, h.context(), {
          roundId: "r1",
          answers: [{ ...first("retry"), pass: "retry" }],
        }),
      ).toStrictEqual({ ok: false, error: { code: "ERR_ROUND_CLOSED" } });
    });

    it("retains several retry entries without another first count or FSRS movement", async () => {
      const deps = await ready();
      const answers = [
        first("first"),
        { ...first("retry-a"), pass: "retry" as const },
        { ...first("retry-b", "again"), pass: "retry" as const },
      ];
      expect(
        (await recordAnswers(deps, h.context(), { roundId: "r1", answers })).ok,
      ).toBe(true);
      const store = deps.stores.forLearner(h.learner);
      expect(await store.reviewsOf("r1")).toHaveLength(3);
      expect((await store.round("r1"))?.value.firstPass).toBe(1);
      expect((await store.items()).get(CARD)?.value.fsrs?.reps).toBe(1);
      expect((await store.stats())?.value.said).toBe(3);
    });

    it("validates the whole batch even when one first answer is already adopted", async () => {
      const deps = await ready();
      expect(
        (
          await recordAnswers(deps, h.context(), {
            roundId: "r1",
            answers: [first("original")],
          })
        ).ok,
      ).toBe(true);
      const store = deps.stores.forLearner(h.learner);
      const before = await saved(store);
      expect(
        await recordAnswers(deps, h.context(), {
          roundId: "r1",
          answers: [first("other"), { ...first("foreign"), roundId: "r2" }],
        }),
      ).toStrictEqual({ ok: false, error: { code: "ERR_BAD_REQUEST" } });
      expect(await saved(store)).toStrictEqual(before);
    });

    it("keeps adoption scoped to one learner", async () => {
      const deps = await ready();
      expect(
        (
          await recordAnswers(deps, h.context(), {
            roundId: "r1",
            answers: [first("a")],
          })
        ).ok,
      ).toBe(true);
      const other = learnerId("learner-b");
      expect(
        await recordAnswers(
          deps,
          {
            ...h.context(),
            actor: { kind: "learner", learnerId: other },
            learner: { ...h.context().learner, id: other },
          },
          { roundId: "r1", answers: [first("b")] },
        ),
      ).toStrictEqual({ ok: false, error: { code: "ERR_ROUND_NOT_FOUND" } });
      await once(deps.stores.forLearner(h.learner));
      expect(await deps.stores.forLearner(other).reviews()).toStrictEqual([]);
    });
  });
}
