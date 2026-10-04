import { describe, expect, it } from "vitest";
import {
  initPagedVocab,
  pagedVocabReducer,
  type VocabPage,
  type VocabPagedState,
} from "@instant-composition/web";
import { vocabCard, vocabSession } from "./web-vocab-fixtures";

function page(index: number, count = 64, more = true): VocabPage {
  return {
    ...vocabSession(),
    generation: 1,
    page: index,
    total: 320,
    answered: [],
    retained: [],
    continuation: more ? `1:${String(index + 1)}` : null,
    cards: Array.from({ length: count }, (_, slot) => ({
      ...vocabCard(`v_${String(index * 64 + slot)}`),
      slot,
    })),
  };
}
function grade(
  state: VocabPagedState,
  value: "again" | "good" = "good",
): VocabPagedState {
  let next = pagedVocabReducer(state, { type: "shown", at: 1 });
  next = pagedVocabReducer(next, { type: "flip", at: 2 });
  next = pagedVocabReducer(next, {
    type: "grade",
    at: 3,
    wall: 10,
    grade: value,
    key: false,
  });
  return pagedVocabReducer(next, { type: "advance", at: 4 });
}
describe("one continuous vocabulary deck", () => {
  it("preserves a late-page retry gap and identity while automatically replacing the page", () => {
    let state = initPagedVocab(page(0), []);
    for (let index = 0; index < 62; index += 1) state = grade(state);
    state = grade(state, "again");
    state = grade(state);
    expect(state.phase.kind).toBe("finishing");
    expect(state.continuation).toBe("1:1");
    expect(state.reAsks).toStrictEqual([{ cardId: "v_62", due: 68 }]);
    state = pagedVocabReducer(state, { type: "page", page: page(1) });
    expect(state.card?.cardId).toBe("v_64");
    state = grade(state);
    expect(state.card?.cardId).toBe("v_65");
    state = grade(state);
    expect(state.card?.cardId).toBe("v_66");
    state = grade(state);
    expect(state.card?.cardId).toBe("v_62");
    state = pagedVocabReducer(state, { type: "shown", at: 1 });
    state = pagedVocabReducer(state, { type: "flip", at: 2 });
    state = pagedVocabReducer(state, {
      type: "grade",
      at: 3,
      wall: 10,
      grade: "good",
      key: false,
    });
    expect(state.answers[0]).toMatchObject({
      id: "p:0:1:62",
      vocabPage: 0,
      vocabGeneration: 1,
    });
    expect(state.firstShown).toBe(67);
  });
  it("bounds retained card bodies, tallies and retries across320 firsts all graded again with unchanged caps", () => {
    let state = initPagedVocab(page(0), []);
    const asks = new Map<string, number>();
    let firsts = 0;
    for (let iteration = 0; iteration < 320 * 12; iteration += 1) {
      if (state.phase.kind === "finishing") {
        if (state.continuation === null) break;
        const index = Number(state.continuation.split(":")[1]);
        state = pagedVocabReducer(state, {
          type: "page",
          page: page(index, 64, index < 4),
        });
      }
      const card = state.card;
      if (card === undefined) throw new Error("Expected a current card.");
      if (card.pass === "first") firsts += 1;
      asks.set(card.cardId, Math.max(asks.get(card.cardId) ?? 0, card.ask));
      state = grade(state, "again");
      expect(Object.keys(state.cards).length).toBeLessThanOrEqual(80);
      expect(Object.keys(state.asked).length).toBeLessThanOrEqual(80);
      expect(state.reAsks.length).toBeLessThanOrEqual(16);
      expect(state.answers.length).toBeLessThanOrEqual(1);
    }
    expect(firsts).toBe(320);
    expect(state.phase.kind).toBe("finishing");
    expect(state.continuation).toBeNull();
    expect([...asks.values()].every((ask) => ask === 10)).toBe(true);
  });
});
