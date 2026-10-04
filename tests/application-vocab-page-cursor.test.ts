import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@instant-composition/domain";
import {
  learnerId,
  preparePagedVocabSession,
  type Entry,
} from "@instant-composition/application";
import { decodeStorageRecord, StorageSchemaError } from "@instant-composition/adapters";
import { BUILDING_VOCAB_FIXTURE } from "./vocab-building-fixture";
import {
  fixedCatalog,
  makeHarness,
  makeSnapshot,
  vocabItem,
} from "./application-harness";
import {
  makeStats,
  makeVocabCandidate,
  makeVocabProgress,
  makeVocabReadModel,
} from "./application-fixtures";

const header = BUILDING_VOCAB_FIXTURE.value;
const ids = Array.from(
  { length: 130 },
  (_, i) => `v_build_${String(i).padStart(3, "0")}`,
);
const prefix = `READMODEL#VOCAB#${header.day}#${encodeURIComponent(header.candidateGeneration)}#due#all#all#`;
const legacyCursor = JSON.stringify({
  PK: BUILDING_VOCAB_FIXTURE.PK,
  SK: `${prefix}13fe0000000000000#0000000000063#v_build_063`,
});

async function interrupted(dueCursor: string) {
  const vocab = ids.map((id, i) => ({ ...vocabItem("word", 1, i), id }));
  const base = makeHarness(
    fixedCatalog({ ...makeSnapshot({ vocab }), version: header.catalog }),
  );
  const owner = learnerId("fixture-owner");
  const context = {
    ...base.context(),
    actor: { kind: "learner" as const, learnerId: owner },
    learner: { ...base.context().learner, id: owner },
  };
  const store = base.stores.forLearner(owner);
  for (let i = 0; i < 8; i += 1) {
    expect(
      (
        await store.commit({
          puts: ids.slice(i * 17, (i + 1) * 17).map((cardId) => ({
            type: "vocabItem" as const,
            value: makeVocabProgress({
              cardId,
              state: {
                stability: 2,
                difficulty: 5,
                lapses: 0,
                reps: 1,
                dueDay: header.day,
                lastDay: "2026-09-21",
              },
            }),
          })),
          updates: [],
          expect: [],
        })
      ).ok,
    ).toBe(true);
  }
  expect((await store.readModelSource())?.version).toBe(header.sourceVersion);
  const entries = [
    {
      type: "settings" as const,
      value: {
        ...DEFAULT_SETTINGS,
        topics: ["work"],
        vocabNewPerDay: 0,
        vocabReviewsPerDay: null,
      },
    },
    { type: "stats" as const, value: makeStats() },
    {
      type: "vocabReadModel" as const,
      value: makeVocabReadModel({
        catalog: header.catalog,
        generation: header.candidateGeneration,
        sourceVersion: header.sourceVersion,
      }),
    },
    { type: "vocabPagedSession" as const, value: { ...header, dueCursor } },
  ] satisfies readonly Entry[];
  for (const [i, entry] of entries.entries()) {
    const version = [1, 9, 10, 9][i] ?? 1;
    expect((await store.commit({ puts: [entry], updates: [], expect: [] })).ok).toBe(
      true,
    );
    for (let current = 1; current < version; current += 1)
      expect(
        (
          await store.commit({
            puts: [],
            updates: [{ entry, version: current }],
            expect: [],
          })
        ).ok,
      ).toBe(true);
  }
  for (let from = 0; from < ids.length; from += 50)
    expect(
      (
        await store.commit({
          puts: ids.slice(from, from + 50).map((cardId, offset) => ({
            type: "vocabCandidate" as const,
            value: makeVocabCandidate({
              day: header.day,
              generation: header.candidateGeneration,
              cardId,
              order: `13fe0000000000000#${String(from + offset).padStart(13, "0")}`,
            }),
          })),
          updates: [],
          expect: [],
        })
      ).ok,
    ).toBe(true);
  expect(
    (
      await store.commit({
        puts: [
          {
            type: "vocabDeckPage",
            value: {
              sessionId: header.id,
              generation: 1,
              page: 0,
              cards: ids.slice(0, 64).map((id) => ({ id, isNew: false })),
            },
          },
        ],
        updates: [],
        expect: [],
      })
    ).ok,
  ).toBe(true);
  return { ...base, context: () => context, store };
}

describe("persisted preparation cursor compatibility", () => {
  it.each([header.dueCursor, legacyCursor])(
    "resumes an exact published building checkpoint without repeating its prefix",
    async (cursor) => {
      const h = await interrupted(cursor);
      const before = await h.store.vocabPagedSession(header.id);
      expect(before).toStrictEqual({
        value: { ...header, dueCursor: cursor },
        version: 9,
      });
      const result = await preparePagedVocabSession(h.deps, h.context(), header.id);
      expect(result.ok && result.value).toMatchObject({
        status: "building",
        generation: 1,
      });
      expect(
        (await h.store.vocabDeckPage(header.id, 1, 1))?.value.cards.map(
          (card) => card.id,
        ),
      ).toStrictEqual(ids.slice(64, 128));
      const next = await h.store.vocabPagedSession(header.id);
      expect(next?.value.dueRead).toBe(128);
      expect(next?.value.dueCursor).toMatch(/^LEARNER%23fixture-owner\|/);
      expect((await preparePagedVocabSession(h.deps, h.context(), header.id)).ok).toBe(
        true,
      );
      expect((await h.store.vocabPagedSession(header.id))?.value).toMatchObject({
        status: "ready",
        pages: 3,
        total: 130,
      });
    },
  );

  it("preserves both known raw forms and refuses foreign or unknown cursor fields before normalization", () => {
    for (const dueCursor of [header.dueCursor, legacyCursor])
      expect(
        decodeStorageRecord({
          ...BUILDING_VOCAB_FIXTURE,
          value: { ...header, dueCursor },
        }).value,
      ).toStrictEqual({ ...header, dueCursor });
    for (const dueCursor of [
      JSON.stringify({ PK: "LEARNER#foreign", SK: `${prefix}01#v1` }),
      JSON.stringify({
        PK: BUILDING_VOCAB_FIXTURE.PK,
        SK: `${prefix}01#v1`,
        future: true,
      }),
      legacyCursor.replace("2026-09-22", "2026-09-21"),
      legacyCursor.replace("fixture-catalog", "foreign-catalog"),
      "{malformed",
    ])
      expect(() =>
        decodeStorageRecord({
          ...BUILDING_VOCAB_FIXTURE,
          value: { ...header, dueCursor },
        }),
      ).toThrow(StorageSchemaError);
  });
});
