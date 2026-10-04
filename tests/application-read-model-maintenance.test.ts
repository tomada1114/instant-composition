import { describe, expect, it } from "vitest";
import {
  advanceReadModelMaintenance,
  finishVocabSession,
  startVocabSession,
  vocabHub,
  type ApplicationDeps,
} from "@instant-composition/application";
import { makeVocabProgress, makeVocabSession } from "./application-fixtures";
import { DAY_MS, makeHarness, NOON, type Harness } from "./application-harness";
import type { maintenanceHarness } from "./read-model-maintenance-harness";

async function registeredMaintenance(h: Harness) {
  await h.stores.forLearner(h.learner).commit({
    puts: [
      {
        type: "profile",
        value: {
          timeZone: h.context().learner.timeZone,
          l1: h.context().learner.l1,
          target: h.context().learner.target,
          uiLocale: h.context().learner.uiLocale,
        },
      },
    ],
    updates: [],
    expect: [],
  });
  const base = h.stores.maintenance();
  let pages = 0;
  return {
    scans: () => pages,
    maintenance: {
      ...base,
      profiles: (cursor: string | null) => {
        pages += 1;
        return base.profiles(cursor);
      },
    },
  };
}

async function drain(
  deps: ApplicationDeps,
  maintenance: ReturnType<typeof maintenanceHarness>["maintenance"],
  now: number,
) {
  for (let step = 0; step < 200; step += 1) {
    const result = await advanceReadModelMaintenance(deps, maintenance, now);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.rows).toBeLessThanOrEqual(20);
    if (result.value.status === "idle") return;
  }
  throw new Error("The bounded fixture worker did not finish.");
}

describe("independent day preparation", () => {
  it("prepares today and tomorrow, keeps normal answers ready, and resumes after a missed scheduler day", async () => {
    const h = makeHarness();
    const fixture = await registeredMaintenance(h);
    expect((await vocabHub(h.deps, h.context())).ok).toBe(false);
    await drain(h.deps, fixture.maintenance, NOON);
    const started = await startVocabSession(h.deps, h.context(), {
      sessionId: "s",
      kind: "today",
    });
    if (!started.ok) throw new Error(started.error.code);
    expect(
      (
        await finishVocabSession(h.deps, h.context(), {
          sessionId: "s",
          answers: started.value.cards.map((card) => ({
            id: `a:${card.id}`,
            cardId: card.id,
            grade: "good",
            pass: "first",
            elapsedMs: 1,
          })),
        })
      ).ok,
    ).toBe(true);
    expect((await vocabHub(h.deps, h.context(NOON + DAY_MS))).ok).toBe(true);
    expect(await vocabHub(h.deps, h.context(NOON + 2 * DAY_MS))).toStrictEqual({
      ok: false,
      error: { code: "ERR_READ_MODEL_NOT_READY" },
    });
    await drain(h.deps, fixture.maintenance, NOON + 2 * DAY_MS);
    expect((await vocabHub(h.deps, h.context(NOON + 2 * DAY_MS))).ok).toBe(true);
    expect(fixture.scans()).toBe(2);
  });

  it("schedules an old offline finish, keeps its original day, and closes only after bounded maintenance", async () => {
    const h = makeHarness();
    const store = h.stores.forLearner(h.learner);
    await store.commit({
      puts: [
        {
          type: "vocabSession",
          value: makeVocabSession({ day: "2026-09-19", deck: [] }),
        },
        ...["v_idiom-3-0", "v_idiom-3-1"].map((cardId, index) => ({
          type: "vocabItem" as const,
          value: makeVocabProgress({
            cardId,
            firstDay: "2026-09-17",
            state: {
              stability: 1,
              difficulty: 4,
              reps: 1,
              lapses: 0,
              lastDay: "2026-09-17",
              dueDay: index === 0 ? "2026-09-20" : "2026-09-21",
            },
          }),
        })),
      ],
      updates: [],
      expect: [],
    });
    expect(
      await finishVocabSession(h.deps, h.context(), { sessionId: "s1", answers: [] }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_READ_MODEL_NOT_READY" } });
    expect((await store.vocabReadModelRequest("2026-09-19"))?.value).toStrictEqual({
      schema: 1,
      day: "2026-09-19",
    });
    expect((await store.vocabSession("s1"))?.value.finishedAt).toBeNull();
    const fixture = await registeredMaintenance(h);
    await drain(h.deps, fixture.maintenance, NOON);
    expect(await store.vocabReadModelRequest("2026-09-19")).toBeUndefined();
    const finished = await finishVocabSession(h.deps, h.context(), {
      sessionId: "s1",
      answers: [],
    });
    expect(finished.ok && finished.value).toMatchObject({
      day: "2026-09-19",
      tomorrow: 1,
    });
  });

  it("resumes safely after a checkpoint save failed following a committed page", async () => {
    const h = makeHarness();
    const fixture = await registeredMaintenance(h);
    const failed = {
      ...fixture.maintenance,
      save: () => Promise.reject(new Error("storage fault")),
    };
    await expect(
      advanceReadModelMaintenance(h.deps, failed, NOON),
    ).rejects.toBeInstanceOf(Error);
    await drain(h.deps, fixture.maintenance, NOON);
    const model = await h.stores.forLearner(h.learner).vocabReadModel("2026-09-22");
    expect(model?.value.counts.reduce((sum, count) => sum + count.total, 0)).toBe(40);
    expect((await vocabHub(h.deps, h.context())).ok).toBe(true);
  });
});
