import { expect } from "vitest";
import {
  startPagedVocabSession,
  preparePagedVocabSession,
  updateSettings,
  type LearnerStores,
  type LearnerId,
  type ApplicationDeps,
  type RequestContext,
  type VocabPreparation,
} from "@instant-composition/application";
import {
  fixedCatalog,
  makeHarness,
  makeSnapshot,
  vocabItem,
} from "./application-harness";
import { makeVocabProgress } from "./application-fixtures";
import { prepareVocabReadModels } from "./read-model-harness";

export interface PagedHarness {
  readonly deps: ApplicationDeps;
  context(): RequestContext;
}
export async function pagedFixture(
  size = 193,
  stores?: LearnerStores,
  largeText = false,
): Promise<
  PagedHarness & { readonly learner: LearnerId; readonly stores: LearnerStores }
> {
  const vocab = Array.from({ length: size }, (_, index) => ({
    ...vocabItem(index % 2 === 0 ? "word" : "idiom", 4, index),
    id: `v_due_${String(index).padStart(4, "0")}`,
    ...(largeText
      ? {
          headword: `${"界".repeat(2044)}${String(index).padStart(4, "0")}`,
          meaning: "義".repeat(20),
        }
      : {}),
  }));
  const base = makeHarness(fixedCatalog(makeSnapshot({ vocab })));
  const h = {
    ...base,
    stores: stores ?? base.stores,
    deps: { ...base.deps, stores: stores ?? base.stores },
  };
  const store = h.stores.forLearner(h.learner);
  for (let index = 0; index < vocab.length; index += 50) {
    const written = await store.commit({
      puts: vocab.slice(index, index + 50).map((card) => ({
        type: "vocabItem" as const,
        value: makeVocabProgress({
          cardId: card.id,
          state: {
            dueDay: "2026-09-22",
            lastDay: "2026-09-21",
            stability: 2,
            difficulty: 5,
            lapses: 0,
            reps: 1,
          },
        }),
      })),
      updates: [],
      expect: [],
    });
    expect(written.ok).toBe(true);
  }
  expect(
    (
      await updateSettings(h.deps, h.context(), {
        topics: ["work"],
        vocabNewPerDay: 0,
        vocabReviewsPerDay: null,
      })
    ).ok,
  ).toBe(true);
  await prepareVocabReadModels(h.deps, h.context());
  return h;
}

export async function readyPaged(
  h: PagedHarness,
  sessionId = "paged",
): Promise<VocabPreparation> {
  let result = await startPagedVocabSession(h.deps, h.context(), {
    sessionId,
    kind: "today",
  });
  if (!result.ok) throw new Error(result.error.code);
  for (let index = 0; result.value.status === "building" && index < 100; index += 1) {
    result = await preparePagedVocabSession(h.deps, h.context(), sessionId);
    if (!result.ok) throw new Error(result.error.code);
  }
  expect(result.value.status).toBe("ready");
  return result.value;
}
