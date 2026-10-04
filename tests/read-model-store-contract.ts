import { describe, expect, it } from "vitest";
import {
  learnerId,
  rebuildVocabReadModel,
  vocabHub,
  type LearnerStores,
} from "@instant-composition/application";
import { makePersonalCard } from "./application-fixtures";
import { makeHarness } from "./application-harness";
import { prepareVocabReadModels } from "./read-model-harness";

/** The same primary-page, source-CAS, and isolation behavior on both adapters. */
export function describeReadModelStoreContract(
  name: string,
  createStores: () => LearnerStores | Promise<LearnerStores>,
): void {
  describe(`${name}: bounded read models`, () => {
    it("pages one bucket without crossing learner, generation, or cursor scope", async () => {
      const h = makeHarness();
      const stores = await createStores();
      const deps = { ...h.deps, stores };
      await prepareVocabReadModels(deps, h.context());
      const store = stores.forLearner(h.learner);
      const model = await store.vocabReadModel("2026-09-22");
      if (model === undefined) throw new Error("No fixture generation.");
      const request = {
        day: model.value.day,
        generation: model.value.generation,
        mode: "fresh" as const,
        category: "word" as const,
        level: null,
        limit: 2,
        cursor: null,
      };
      const first = await store.vocabCandidates(request);
      expect(first.rows).toHaveLength(2);
      expect(typeof first.cursor).toBe("string");
      const second = await store.vocabCandidates({ ...request, cursor: first.cursor });
      expect(second.rows).toHaveLength(2);
      expect(
        new Set([...first.rows, ...second.rows].map(({ value }) => value.cardId)).size,
      ).toBe(4);
      const other = stores.forLearner(learnerId("other"));
      expect((await other.vocabCandidates(request)).rows).toStrictEqual([]);
      await expect(
        other.vocabCandidates({ ...request, cursor: first.cursor }),
      ).rejects.toBeInstanceOf(RangeError);
      await expect(
        store.vocabCandidates({ ...request, category: "idiom", cursor: first.cursor }),
      ).rejects.toBeInstanceOf(RangeError);
      await expect(
        store.vocabCandidates({ ...request, limit: 251 }),
      ).rejects.toBeInstanceOf(RangeError);
      expect(
        (await store.vocabCandidates({ ...request, generation: "another" })).rows,
      ).toStrictEqual([]);
    });

    it("source epoch advances only with a successful source transaction and rejects stale activation", async () => {
      const h = makeHarness();
      const stores = await createStores();
      const deps = { ...h.deps, stores };
      await prepareVocabReadModels(deps, h.context());
      const store = stores.forLearner(h.learner);
      const model = await store.vocabReadModel("2026-09-22");
      if (model === undefined) throw new Error("No fixture model.");
      const card = makePersonalCard();
      expect(
        (
          await store.commit({
            puts: [{ type: "card", value: card }],
            updates: [],
            expect: [],
          })
        ).ok,
      ).toBe(true);
      expect((await store.readModelSource())?.version).toBe(1);
      expect(
        (
          await store.commit({
            puts: [{ type: "card", value: card }],
            updates: [],
            expect: [],
          })
        ).ok,
      ).toBe(false);
      expect((await store.readModelSource())?.version).toBe(1);
      expect(
        await store.commit({
          puts: [],
          updates: [
            {
              entry: { type: "vocabReadModel", value: model.value },
              version: model.version,
            },
          ],
          expect: [{ key: { type: "readModelSource" }, version: null }],
        }),
      ).toStrictEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
      expect(await vocabHub(deps, h.context())).toStrictEqual({
        ok: false,
        error: { code: "ERR_READ_MODEL_NOT_READY" },
      });
      const worker = {
        ...h.context(),
        actor: {
          kind: "system" as const,
          job: "rebuild-projections" as const,
          onBehalfOf: h.learner,
        },
      };
      expect((await rebuildVocabReadModel(deps, worker)).ok).toBe(true);
      await prepareVocabReadModels(deps, h.context());
      expect((await vocabHub(deps, h.context())).ok).toBe(true);
    });

    it("rejects logically expired state even before eventual TTL deletion", async () => {
      const h = makeHarness();
      const stores = await createStores();
      const deps = { ...h.deps, stores };
      await prepareVocabReadModels(deps, h.context());
      const store = stores.forLearner(h.learner);
      const model = await store.vocabReadModel("2026-09-22");
      if (model === undefined) throw new Error("No fixture state.");
      await store.commit({
        puts: [],
        updates: [
          {
            entry: {
              type: "vocabReadModel",
              value: { ...model.value, expiresAt: Math.floor(h.context().now / 1_000) },
            },
            version: model.version,
          },
        ],
        expect: [],
      });
      expect(await vocabHub(deps, h.context())).toStrictEqual({
        ok: false,
        error: { code: "ERR_READ_MODEL_NOT_READY" },
      });
      await prepareVocabReadModels(deps, h.context());
      expect((await vocabHub(deps, h.context())).ok).toBe(true);
    });

    it("pages requested maintenance days independently of card/history buckets", async () => {
      const h = makeHarness();
      const stores = await createStores();
      const store = stores.forLearner(h.learner);
      expect(
        (
          await store.commit({
            puts: Array.from({ length: 12 }, (_, index) => ({
              type: "vocabReadModelRequest" as const,
              value: {
                schema: 1 as const,
                day: `2025-01-${String(index + 1).padStart(2, "0")}`,
              },
            })),
            updates: [],
            expect: [],
          })
        ).ok,
      ).toBe(true);
      const first = await store.vocabReadModelRequests(null);
      expect(first.rows).toHaveLength(10);
      expect((await store.vocabReadModelRequests(first.cursor)).rows).toHaveLength(2);
      const other = stores.forLearner(learnerId("other"));
      await expect(other.vocabReadModelRequests(first.cursor)).rejects.toBeInstanceOf(
        RangeError,
      );
      expect(await other.vocabReadModelRequest("2025-01-01")).toBeUndefined();
    });
  });
}
