import { describe, expect, it } from "vitest";
import {
  currentCard,
  drillReducer,
  initDrill,
  initStudy,
  studyReducer,
  type Grade,
  type StudyEvent,
  type StudyState,
} from "@instant-composition/web";

function driver<S extends StudyState>(
  initial: S,
  reduce: (state: S, event: StudyEvent) => S,
) {
  let state = initial;
  const event = (value: StudyEvent): void => {
    state = reduce(state, value);
  };
  return {
    state: () => state,
    event,
    grade(grade: Grade) {
      event({ type: "shown", at: 0 });
      event({ type: "flip", at: 1000 });
      event({ type: "grade", grade, at: 1200, wall: 1_790_000_001_200, key: false });
      event({ type: "advance", at: 1500 });
    },
  };
}

const activities = [
  {
    name: "vocabulary study",
    start: (count: number, isNew = false, retries = true) => {
      const deck = Array.from({ length: count }, (_, i) => `c${String(i + 1)}`);
      return driver(
        initStudy({
          sessionId: "s",
          deck,
          isNew: { c1: isNew },
          answered: [],
          retries,
          intro: false,
        }),
        studyReducer,
      );
    },
  },
  {
    name: "timed drill",
    start: (count: number, isNew = false, retries = true) => {
      const deck = Array.from({ length: count }, (_, i) => `c${String(i + 1)}`);
      return driver(
        initDrill({
          roundId: "s",
          deck,
          limits: Object.fromEntries(deck.map((id) => [id, 7000])),
          fastThresholds: {},
          isNew: { c1: isNew },
          answered: [],
          retries,
          intro: false,
        }),
        drillReducer,
      );
    },
  },
];

describe.each(activities)("shared study contract: $name", ({ start }) => {
  it.each([
    ["again", 4],
    ["hard", 8],
    ["good", 12],
  ] as const)("re-asks a new card graded %s after %i other cards", (grade, gap) => {
    const session = start(14, true);
    session.grade(grade);
    for (let i = 0; i < gap; i += 1) session.grade("good");
    expect(currentCard(session.state())).toStrictEqual({
      cardId: "c1",
      pass: "retry",
      ask: 1,
    });
    expect(session.state().answers[0]).toMatchObject({
      id: "s:f:c1",
      roundId: "s",
      grade,
      timedOut: false,
    });
  });

  it("never exceeds ten re-asks even when nothing else is left", () => {
    const session = start(1);
    for (let i = 0; i < 11; i += 1) session.grade("again");
    expect(session.state().phase.kind).toBe("finishing");
    expect(session.state().answers).toHaveLength(11);
    expect(session.state().answers[10]?.id).toBe("s:r10:c1");
  });

  it("avoids consecutive appearances while another re-ask waits", () => {
    const session = start(2);
    session.grade("again");
    session.grade("again");
    expect(currentCard(session.state())?.cardId).toBe("c1");
    session.grade("again");
    expect(currentCard(session.state())?.cardId).toBe("c2");
  });

  it("finishes without re-asks when the activity disables them", () => {
    const session = start(1, true, false);
    session.grade("again");
    expect(session.state().phase.kind).toBe("finishing");
    expect(session.state().answers).toHaveLength(1);
  });

  it("freezes the front on hide and rejects grading until resumed and flipped", () => {
    const session = start(1);
    session.event({ type: "shown", at: 0 });
    session.event({ type: "hide", at: 500 });
    session.event({
      type: "grade",
      grade: "good",
      at: 1000,
      wall: 1_790_000_001_000,
      key: true,
    });
    expect(session.state().answers).toStrictEqual([]);
    expect(session.state().paused).toBe(true);
    session.event({ type: "resume", at: 2000 });
    session.event({ type: "flip", at: 2500 });
    expect(session.state().phase).toMatchObject({
      kind: "back",
      elapsedMs: 1000,
      mode: "self",
    });
  });
});

describe("activity timing adapters", () => {
  it("keeps vocabulary on its front after a long wait, with no drill configuration", () => {
    const state = initStudy({
      sessionId: "v",
      deck: ["c1"],
      isNew: {},
      answered: [],
      retries: true,
      intro: false,
    });
    const shown = studyReducer(state, { type: "shown", at: 0 });
    const later = studyReducer(shown, { type: "tick", at: 100_000 });
    expect(later.phase.kind).toBe("front");
    expect(later).not.toHaveProperty("limits");
    expect(later).not.toHaveProperty("combo");
    expect(later).not.toHaveProperty("untimed");
  });
});
