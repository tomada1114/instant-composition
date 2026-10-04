import { describe, expect, it } from "vitest";
import {
  learnerId,
  getPagedVocabPage,
  recordPagedVocabAnswers,
  finishPagedVocabSession,
  type Entry,
  type LearnerStores,
} from "@instant-composition/application";
import { pagedFixture, readyPaged } from "./vocab-pages-harness";
import { makeVocabPagedSession, makeVocabCandidate } from "./application-fixtures";

/** The same logical flow proves persisted membership, progress and replay on both adapters. */
export function describePagedVocabStore(
  name: string,
  stores: () => Promise<LearnerStores>,
  wire?: readonly string[],
): void {
  describe(`paged vocabulary with ${name}`, () => {
    it("rejects oversized paged values atomically before puts or updates", async () => {
      const store = (await stores()).forLearner(learnerId("paged-bounds"));
      const original = makeVocabPagedSession();
      expect(
        (
          await store.commit({
            puts: [{ type: "vocabPagedSession", value: original }],
            updates: [],
            expect: [],
          })
        ).ok,
      ).toBe(true);
      const invalid: Entry[] = [
        {
          type: "vocabDeckPage",
          value: {
            sessionId: original.id,
            generation: 0,
            page: 0,
            cards: Array<{ readonly id: string; readonly isNew: boolean }>(65).fill({
              id: "v1",
              isNew: false,
            }),
          },
        },
        {
          type: "vocabPageProgress",
          value: {
            sessionId: original.id,
            generation: 0,
            page: 0,
            answered: Array<string>(65).fill("v1"),
          },
        },
        {
          type: "vocabSessionGuard",
          value: { id: "x".repeat(201), finishedAt: null },
        },
      ];
      for (const entry of invalid)
        await expect(
          store.commit({
            puts: [entry],
            updates: [
              {
                entry: {
                  type: "vocabPagedSession",
                  value: { ...original, answered: 1 },
                },
                version: 1,
              },
            ],
            expect: [],
          }),
        ).rejects.toThrow();
      await expect(
        store.commit({
          puts: [],
          updates: [
            {
              entry: {
                type: "vocabPagedSession",
                value: { ...original, day: "2026-09-22-extra" },
              },
              version: 1,
            },
          ],
          expect: [],
        }),
      ).rejects.toThrow();
      expect(await store.vocabPagedSession(original.id)).toStrictEqual({
        value: original,
        version: 1,
      });
      expect(await store.vocabDeckPage(original.id, 0, 0)).toBeUndefined();
      expect(await store.vocabPageProgress(original.id, 0, 0)).toBeUndefined();
    });
    it("refuses foreign or malformed cursor writes before any companion mutation", async () => {
      const store = (await stores()).forLearner(learnerId("cursor-owner"));
      const prefix = "READMODEL#VOCAB#2026-09-22#none#due#all#all#";
      const foreign = JSON.stringify({ PK: "LEARNER#foreign", SK: `${prefix}01#v1` });
      const invalid = [
        foreign,
        JSON.stringify({
          PK: "LEARNER#cursor-owner",
          SK: `${prefix}01#v1`,
          extra: true,
        }),
        JSON.stringify({
          PK: "LEARNER#cursor-owner",
          SK: "READMODEL#VOCAB#2026-09-21#none#due#all#all#01#v1",
        }),
        "LEARNER%23cursor-owner|wrong|01#v1",
      ];
      for (const dueCursor of invalid) {
        await expect(
          store.commit({
            puts: [
              {
                type: "vocabSessionGuard",
                value: { id: "companion", finishedAt: null },
              },
              {
                type: "vocabPagedSession",
                value: makeVocabPagedSession({ dueCursor }),
              },
            ],
            updates: [],
            expect: [],
          }),
        ).rejects.toThrow();
        expect(await store.vocabSessionGuard("companion")).toBeUndefined();
        expect(await store.vocabPagedSession("s1")).toBeUndefined();
      }
    });
    it("consumes both learner-bound cursor forms and refuses foreign ranges on either adapter", async () => {
      const store = (await stores()).forLearner(learnerId("cursor-owner"));
      const prefix = "READMODEL#VOCAB#2026-09-22#none#due#all#all#";
      expect(
        (
          await store.commit({
            puts: [
              {
                type: "vocabCandidate",
                value: makeVocabCandidate({ cardId: "v1", order: "01" }),
              },
              {
                type: "vocabCandidate",
                value: makeVocabCandidate({ cardId: "v2", order: "02" }),
              },
            ],
            updates: [],
            expect: [],
          })
        ).ok,
      ).toBe(true);
      const request = {
        day: "2026-09-22",
        generation: "none",
        mode: "due" as const,
        category: null,
        level: null,
        limit: 1,
      };
      const key = { PK: "LEARNER#cursor-owner", SK: `${prefix}01#v1` };
      for (const cursor of [
        JSON.stringify(key),
        `${encodeURIComponent(key.PK)}|${encodeURIComponent(prefix)}|${key.SK}`,
      ])
        expect(
          (await store.vocabCandidates({ ...request, cursor })).rows.map(
            (row) => row.value.cardId,
          ),
        ).toStrictEqual(["v2"]);
      for (const cursor of [
        JSON.stringify({ ...key, PK: "LEARNER#foreign" }),
        JSON.stringify({ ...key, extra: true }),
        JSON.stringify({ ...key, SK: "CARD#foreign" }),
      ])
        await expect(store.vocabCandidates({ ...request, cursor })).rejects.toThrow(
          RangeError,
        );
    });
    it("answers a maximum 60-input batch, crosses immutable pages and replays after close under a small guard", async () => {
      const h = await pagedFixture(65, await stores(), true);
      const prep = await readyPaged(h);
      const first = await getPagedVocabPage(h.deps, h.context(), {
        sessionId: "paged",
        cursor: null,
      });
      if (!first.ok) throw new Error(first.error.code);
      const answers = first.value.cards.map((card, index) => ({
        id: `answer-${String(index)}`,
        cardId: card.id,
        page: 0,
        pass: "first" as const,
        grade: "again" as const,
        elapsedMs: 100,
      }));
      const before = wire?.length ?? 0;
      for (let from = 0; from < answers.length; from += 60)
        expect(
          (
            await recordPagedVocabAnswers(h.deps, h.context(), {
              sessionId: "paged",
              generation: prep.generation,
              answers: answers.slice(from, from + 60),
            })
          ).ok,
        ).toBe(true);
      const second = await getPagedVocabPage(h.deps, h.context(), {
        sessionId: "paged",
        cursor: first.value.continuation,
      });
      if (!second.ok) throw new Error(second.error.code);
      expect(second.value.cards).toHaveLength(1);
      expect(second.value.continuation).toBeNull();
      expect(
        new Set([...first.value.cards, ...second.value.cards].map((card) => card.id))
          .size,
      ).toBe(65);
      const final = second.value.cards.map((card) => ({
        id: "last",
        cardId: card.id,
        page: 1,
        pass: "first" as const,
        grade: "again" as const,
        elapsedMs: 100,
      }));
      const summary = await finishPagedVocabSession(h.deps, h.context(), {
        sessionId: "paged",
        generation: prep.generation,
        answers: final,
      });
      expect(summary.ok && summary.value.answered).toBe(65);
      expect(summary.ok && summary.value.againCount).toBe(65);
      expect(summary.ok && summary.value.again).toHaveLength(32);
      expect(
        (
          await recordPagedVocabAnswers(h.deps, h.context(), {
            sessionId: "paged",
            generation: prep.generation,
            answers: answers.slice(0, 60),
          })
        ).ok,
      ).toBe(true);
      expect(
        (
          await h.stores
            .forLearner(h.learner)
            .vocabPageProgress("paged", prep.generation, 0)
        )?.value.answered,
      ).toHaveLength(64);
      expect(
        await h.stores.forLearner(learnerId("other")).vocabPagedSession("paged"),
      ).toBeUndefined();
      expect(
        await h.stores
          .forLearner(learnerId("other"))
          .vocabDeckPage("paged", prep.generation, 0),
      ).toBeUndefined();
      if (wire !== undefined) {
        const requests = wire.slice(before).map((raw) => ({
          raw,
          request: JSON.parse(raw) as {
            TransactItems: { Put?: { Item: Record<string, unknown> } }[];
          },
        }));
        expect(requests.length).toBeGreaterThan(0);
        let largestItem = 0;
        for (const { raw, request } of requests) {
          expect(request.TransactItems.length).toBeLessThanOrEqual(100);
          expect(Buffer.byteLength(raw, "utf8")).toBeLessThan(4 * 1024 * 1024);
          for (const action of request.TransactItems)
            if (action.Put !== undefined) {
              expect(action.Put.Item["type"]).not.toStrictEqual({ S: "vocabDeckPage" });
              expect(
                Buffer.byteLength(JSON.stringify(action.Put.Item), "utf8"),
              ).toBeLessThan(400 * 1024);
              largestItem = Math.max(
                largestItem,
                Buffer.byteLength(JSON.stringify(action.Put.Item), "utf8"),
              );
            }
        }
        expect(largestItem).toBeGreaterThan(190_000);
      }
    });
  });
}
