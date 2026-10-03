import { describe, expect, it } from "vitest";

import {
  answerId,
  currentCard,
  type DrillEvent,
  type DrillInit,
  drillReducer,
  type DrillState,
  type Grade,
  initDrill,
  progress,
  remainingMs,
  unsavedAnswers,
  type AnswerInput,
} from "@instant-composition/web";

const LIMIT = 7000;
/** The wall clock, in epoch ms, when the monotonic clock reads zero. */
const WALL = 1_790_000_000_000;

/** `count` card ids, `c1` onwards. */
function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `c${String(index + 1)}`);
}

function each<T>(deck: readonly string[], value: T): Record<string, T> {
  return Object.fromEntries(deck.map((id) => [id, value]));
}

/** A round of `deck`, none of its cards new to the learner unless `overrides` says so. */
function init(overrides: Partial<DrillInit> = {}): DrillState {
  const deck = overrides.deck ?? ids(3);
  return initDrill({
    roundId: "round-1",
    deck,
    limits: each(deck, LIMIT),
    fastThresholds: each(deck, 3500),
    isNew: {},
    answered: [],
    retries: true,
    intro: false,
    ...overrides,
  });
}

function run(state: DrillState, ...events: DrillEvent[]): DrillState {
  return events.reduce(drillReducer, state);
}

/** Shows the current front at `at` and flips it `elapsed` later. */
function flipAfter(state: DrillState, at: number, elapsed: number): DrillState {
  return run(state, { type: "shown", at }, { type: "flip", at: at + elapsed });
}

function grade(state: DrillState, given: Grade, at: number, key = false): DrillState {
  return drillReducer(state, { type: "grade", grade: given, at, wall: WALL + at, key });
}

/** Grades the current card `given` by pointer and moves on past the feedback. */
function answer(state: DrillState, given: Grade, at = 0): DrillState {
  const back = flipAfter(state, at, 2000);
  return drillReducer(grade(back, given, at + 3000), {
    type: "advance",
    at: at + 3500,
  });
}

/** Lets the current front run out, then grades the timed-out back `given`. */
function timeOut(state: DrillState, given: Grade, at = 0): DrillState {
  const back = run(state, { type: "shown", at }, { type: "tick", at: at + LIMIT });
  return drillReducer(grade(back, given, at + LIMIT + 1000), {
    type: "advance",
    at: at + LIMIT + 1500,
  });
}

/** The cards shown, in order, as the session moves through `grades`. */
function shownWhile(state: DrillState, grades: readonly Grade[]): string[] {
  const seen: string[] = [];
  let next = state;
  for (const given of grades) {
    const card = currentCard(next);
    if (card === undefined) break;
    seen.push(card.pass === "first" ? card.cardId : `${card.cardId}↺`);
    next = answer(next, given);
  }
  return seen;
}

describe("starting a drill", () => {
  it("opens on the first card's front with its clock not yet running", () => {
    const state = init();
    expect(currentCard(state)).toStrictEqual({ cardId: "c1", pass: "first", ask: 0 });
    expect(state.phase).toStrictEqual({
      kind: "front",
      spentMs: 0,
      runningSince: null,
      now: null,
    });
    expect(remainingMs(state)).toBe(LIMIT);
  });

  it("waits on the explanation when asked to, and starts on start", () => {
    const state = init({ intro: true });
    expect(state.phase.kind).toBe("intro");
    expect(drillReducer(state, { type: "flip", at: 5 }).phase.kind).toBe("intro");
    expect(drillReducer(state, { type: "start", at: 5 }).phase.kind).toBe("front");
  });
});

describe("the front's clock", () => {
  it("runs from the moment the front is shown", () => {
    const state = run(init(), { type: "shown", at: 1000 }, { type: "tick", at: 3500 });
    expect(remainingMs(state)).toBe(LIMIT - 2500);
  });

  it("ignores a flip before the front was shown", () => {
    const state = drillReducer(init(), { type: "flip", at: 10 });
    expect(state.phase.kind).toBe("front");
  });

  it("flips to the learner's back with the seconds it took, recording nothing yet", () => {
    const state = flipAfter(init(), 1000, 2800);
    expect(state.phase).toMatchObject({ kind: "back", mode: "self", elapsedMs: 2800 });
    expect(state.answers).toStrictEqual([]);
  });

  it("times out on the tick that reaches the limit, recording nothing until a grade", () => {
    const shown = drillReducer(init(), { type: "shown", at: 0 });
    expect(drillReducer(shown, { type: "tick", at: LIMIT - 1 }).phase.kind).toBe(
      "front",
    );
    const state = drillReducer(shown, { type: "tick", at: LIMIT + 40 });
    expect(state.phase).toMatchObject({ kind: "back", mode: "timeout" });
    expect(state.answers).toStrictEqual([]);
  });

  it("treats a flip that comes after the limit as a timeout", () => {
    const state = flipAfter(init(), 0, LIMIT + 5);
    expect(state.phase).toMatchObject({ kind: "back", mode: "timeout" });
  });
});

describe("grading a back", () => {
  it.each([
    [1200, true],
    [1201, false],
  ])("grades a %i ms flip using the card's returned threshold", (elapsedMs, fast) => {
    const state = init({ fastThresholds: each(ids(3), 1200) });
    expect(grade(flipAfter(state, 0, elapsedMs), "good", 2000).phase).toMatchObject({
      fast,
    });
  });

  it.each(["again", "hard", "good"] as const)(
    "ignores the %s key for 150 ms after the back appears",
    (given) => {
      const back = flipAfter(init(), 0, 2000);
      expect(grade(back, given, 2149, true).phase.kind).toBe("back");
      expect(grade(back, given, 2150, true).phase.kind).toBe("feedback");
    },
  );

  it("accepts a pressed button at once", () => {
    const back = flipAfter(init(), 0, 2000);
    expect(grade(back, "good", 2001).phase.kind).toBe("feedback");
  });

  it("records the grade, counts the combo and marks a flip within the API threshold as fast", () => {
    const state = grade(flipAfter(init(), 0, 2100), "good", 3000);
    expect(state.phase).toStrictEqual({
      kind: "feedback",
      mode: "self",
      grade: "good",
      fast: true,
      elapsedMs: 2100,
    });
    expect(state.combo).toBe(1);
    expect(state.answers).toStrictEqual([
      {
        id: answerId("round-1", "c1", 0),
        roundId: "round-1",
        cardId: "c1",
        pass: "first",
        grade: "good",
        timedOut: false,
        elapsedMs: 2100,
        answeredAt: WALL + 3000,
      },
    ]);
  });

  it("calls a △ within the API threshold fast too, and a × never", () => {
    expect(grade(flipAfter(init(), 0, 2100), "hard", 3000).phase).toMatchObject({
      fast: true,
    });
    expect(grade(flipAfter(init(), 0, 2100), "again", 3000).phase).toMatchObject({
      fast: false,
    });
  });

  it("reports each answer as given at the wall-clock time of its grade, not of its flip", () => {
    const back = flipAfter(init(), 0, 2100);
    const graded = drillReducer(back, {
      type: "grade",
      grade: "again",
      at: 5000,
      wall: 1_800_000_000_123,
      key: false,
    });
    expect(graded.answers.map((recorded) => recorded.answeredAt)).toStrictEqual([
      1_800_000_000_123,
    ]);
  });

  it("does not call a flip past the API threshold fast", () => {
    const state = grade(flipAfter(init(), 0, 3600), "good", 4000);
    expect(state.phase).toMatchObject({ fast: false });
  });

  it("judges fast against the API threshold, not a longer limit the round was dealt with", () => {
    const long = init({ limits: each(ids(3), 60_000) });
    expect(grade(flipAfter(long, 0, 3600), "good", 4000).phase).toMatchObject({
      fast: false,
    });
    expect(grade(flipAfter(long, 0, 3500), "good", 4000).phase).toMatchObject({
      fast: true,
    });
  });

  it("moves on to the next front once the feedback is over", () => {
    const state = answer(init(), "good");
    expect(currentCard(state)).toStrictEqual({ cardId: "c2", pass: "first", ask: 0 });
    expect(state.phase).toMatchObject({ kind: "front", runningSince: null });
  });

  it("keeps the combo on △ and ○, and breaks it on ×", () => {
    const twice = answer(answer(init(), "good"), "hard");
    expect(twice.combo).toBe(2);
    const broken = grade(flipAfter(twice, 20_000, 1000), "again", 22_000);
    expect(broken.combo).toBe(0);
    expect(broken.phase).toMatchObject({ kind: "feedback", grade: "again" });
    expect(broken.answers.at(-1)?.grade).toBe("again");
  });

  it("grades a timed-out back with the trio, sending the grade with timedOut and the limit", () => {
    const back = run(init(), { type: "shown", at: 0 }, { type: "tick", at: LIMIT });
    expect(grade(back, "hard", LIMIT + 100, true).phase.kind).toBe("back");
    const graded = grade(back, "hard", LIMIT + 1000, true);
    expect(graded.phase).toStrictEqual({
      kind: "feedback",
      mode: "timeout",
      grade: "hard",
      fast: false,
      elapsedMs: LIMIT,
    });
    expect(graded.answers).toMatchObject([
      { cardId: "c1", grade: "hard", timedOut: true, elapsedMs: LIMIT },
    ]);
    expect(graded.combo).toBe(1);
  });

  it("does not move on from a back without a grade", () => {
    const back = flipAfter(init(), 0, 2000);
    expect(drillReducer(back, { type: "advance", at: 3000 }).phase.kind).toBe("back");
  });
});

describe("pausing", () => {
  it("stops the clock and resumes from what was left", () => {
    const paused = run(
      init(),
      { type: "shown", at: 0 },
      { type: "pause", at: 3000 },
      { type: "tick", at: 60_000 },
    );
    expect(paused.paused).toBe(true);
    expect(paused.phase.kind).toBe("front");
    expect(remainingMs(paused)).toBe(LIMIT - 3000);

    const resumed = run(
      paused,
      { type: "resume", at: 100_000 },
      { type: "tick", at: 103_000 },
    );
    expect(remainingMs(resumed)).toBe(1000);
    expect(drillReducer(resumed, { type: "tick", at: 104_000 }).phase).toMatchObject({
      kind: "back",
      mode: "timeout",
    });
  });

  it("pauses when the page is hidden, and keeps the combo on resume", () => {
    const state = run(answer(init(), "good"), { type: "shown", at: 10_000 });
    const hidden = drillReducer(state, { type: "hide", at: 11_000 });
    expect(hidden.paused).toBe(true);
    const resumed = drillReducer(hidden, { type: "resume", at: 50_000 });
    expect(resumed.paused).toBe(false);
    expect(resumed.combo).toBe(1);
  });

  it("ignores flips and grades while paused", () => {
    const front = run(init(), { type: "shown", at: 0 }, { type: "pause", at: 100 });
    expect(drillReducer(front, { type: "flip", at: 200 }).phase.kind).toBe("front");
    const back = run(flipAfter(init(), 0, 1000), { type: "pause", at: 1500 });
    expect(grade(back, "good", 3000).phase.kind).toBe("back");
  });

  it("restarts the grade-key lock when a paused back resumes", () => {
    const back = run(
      flipAfter(init(), 0, 1000),
      { type: "pause", at: 1500 },
      { type: "resume", at: 9000 },
    );
    expect(grade(back, "good", 9100, true).phase.kind).toBe("back");
    expect(grade(back, "good", 9150, true).phase.kind).toBe("feedback");
  });

  it("finishes the feedback while paused but holds the next clock until resume", () => {
    const feedback = run(grade(flipAfter(init(), 0, 1000), "good", 1500), {
      type: "pause",
      at: 1600,
    });
    const next = run(
      feedback,
      { type: "advance", at: 1800 },
      { type: "shown", at: 1810 },
      { type: "tick", at: 30_000 },
    );
    expect(next.phase).toMatchObject({ kind: "front", runningSince: null });
    expect(remainingMs(next)).toBe(LIMIT);
  });

  it("is not available before the drill starts", () => {
    expect(drillReducer(init({ intro: true }), { type: "pause", at: 0 }).paused).toBe(
      false,
    );
  });
});

describe("re-asks", () => {
  it("brings × back after 4 other cards, marked as a re-ask, and lets it go on ○ (example 2)", () => {
    let state = init({ deck: ids(10) });
    state = answer(answer(state, "good"), "good");
    expect(currentCard(state)?.cardId).toBe("c3");
    state = answer(state, "again");
    expect(progress(state)).toStrictEqual({ position: 4, total: 10, waiting: 1 });
    for (const cardId of ["c4", "c5", "c6", "c7"]) {
      expect(currentCard(state)).toStrictEqual({ cardId, pass: "first", ask: 0 });
      state = answer(state, "good");
    }
    expect(currentCard(state)).toStrictEqual({ cardId: "c3", pass: "retry", ask: 1 });
    expect(progress(state)).toStrictEqual({ position: 7, total: 10, waiting: 0 });

    state = answer(state, "good");
    expect(currentCard(state)).toStrictEqual({ cardId: "c8", pass: "first", ask: 0 });
    expect(state.reAsks).toStrictEqual([]);
    expect(
      state.answers
        .filter((a) => a.cardId === "c3")
        .map((a) => [a.id, a.pass, a.grade]),
    ).toStrictEqual([
      ["round-1:f:c3", "first", "again"],
      ["round-1:r1:c3", "retry", "good"],
    ]);
  });

  it("brings △ back after 8 other cards", () => {
    const state = answer(init({ deck: ids(12) }), "hard");
    expect(shownWhile(state, Array<Grade>(9).fill("good"))).toStrictEqual([
      ...ids(9).slice(1),
      "c1↺",
    ]);
  });

  it("brings a card new to the learner back once more, 12 cards after its first ○, and lets it go at its second", () => {
    const deck = ids(15);
    const state = init({ deck, isNew: { c1: true } });
    expect(shownWhile(state, Array<Grade>(16).fill("good"))).toStrictEqual([
      ...ids(13),
      "c1↺",
      "c14",
      "c15",
    ]);
  });

  it("counts a new card's first ○ wherever it comes, after a miss included", () => {
    const deck = ids(20);
    const state = answer(init({ deck, isNew: { c1: true } }), "again");
    const grades: Grade[] = [...Array<Grade>(4).fill("good"), "good"];
    grades.push(...Array<Grade>(14).fill("good"));
    const seen = shownWhile(state, grades);
    expect(seen.slice(0, 5)).toStrictEqual(["c2", "c3", "c4", "c5", "c1↺"]);
    // c1's first ○ came at its re-ask (seen[4]); 12 other cards later it is back once more.
    expect(seen.indexOf("c1↺", 5)).toBe(4 + 13);
  });

  it("takes the waiting re-asks in the order they fell due once no first pass is left", () => {
    let state = init({ deck: ids(3) });
    state = answer(state, "hard");
    state = answer(state, "again");
    state = answer(state, "again");
    // None is due yet; c2, due first after △'s longer gap on c1, comes at once.
    expect(currentCard(state)).toStrictEqual({ cardId: "c2", pass: "retry", ask: 1 });
    expect(state.reAsks.map((r) => r.cardId)).toStrictEqual(["c1", "c3"]);
    expect(shownWhile(state, ["good", "good", "good"])).toStrictEqual([
      "c2↺",
      "c3↺",
      "c1↺",
    ]);
  });

  it("never shows the same card twice in a row while another waits", () => {
    let state = init({ deck: ids(2) });
    state = answer(state, "again");
    state = answer(state, "again");
    // c1 is on screen; missing it again puts it behind c2, which fell due first.
    expect(currentCard(state)?.cardId).toBe("c1");
    expect(shownWhile(state, ["again", "again", "good", "good"])).toStrictEqual([
      "c1↺",
      "c2↺",
      "c1↺",
      "c2↺",
    ]);
  });

  it("shows a card again at once when it is the only one left", () => {
    const state = answer(init({ deck: ids(1) }), "again");
    expect(currentCard(state)).toStrictEqual({ cardId: "c1", pass: "retry", ask: 1 });
    const again = answer(state, "again");
    expect(currentCard(again)).toStrictEqual({ cardId: "c1", pass: "retry", ask: 2 });
  });

  it("asks one card again at most 10 times", () => {
    let state = answer(init({ deck: ids(1) }), "again");
    for (let ask = 1; ask <= 10; ask += 1) {
      expect(currentCard(state)).toStrictEqual({ cardId: "c1", pass: "retry", ask });
      state = answer(state, "again");
    }
    expect(state.phase.kind).toBe("finishing");
    expect(state.answers.at(-1)?.id).toBe("round-1:r10:c1");
  });

  it("comes back after a timed-out back graded ×, as any ×", () => {
    let state = timeOut(init({ deck: ids(1) }), "again");
    expect(currentCard(state)).toStrictEqual({ cardId: "c1", pass: "retry", ask: 1 });
    state = answer(state, "good");
    expect(state.phase.kind).toBe("finishing");
  });

  it("are left out of a placement round", () => {
    let state = init({ retries: false, isNew: each(ids(3), true) });
    state = answer(state, "again");
    state = answer(state, "hard");
    state = answer(state, "good");
    expect(state.phase.kind).toBe("finishing");
  });

  it("finish the round once every card has left", () => {
    let state = init();
    for (let card = 0; card < 3; card += 1) state = answer(state, "good");
    expect(state.phase.kind).toBe("finishing");
  });
});

describe("resuming a round", () => {
  it("picks up after the answered first passes with the combo at 0", () => {
    const state = init({
      answered: [
        { cardId: "c1", pass: "first" },
        { cardId: "c2", pass: "first" },
      ],
    });
    expect(currentCard(state)).toStrictEqual({ cardId: "c3", pass: "first", ask: 0 });
    expect(progress(state)).toStrictEqual({ position: 3, total: 3, waiting: 0 });
    expect(state.combo).toBe(0);
  });

  it("drops the re-asks that were waiting, as the first answers already set the schedule", () => {
    const state = init({
      answered: [
        { cardId: "c1", pass: "first" },
        { cardId: "c2", pass: "first" },
        { cardId: "c3", pass: "first" },
        { cardId: "c1", pass: "retry" },
      ],
    });
    expect(state.phase.kind).toBe("finishing");
    expect(currentCard(state)).toBeUndefined();
    expect(remainingMs(state)).toBeUndefined();
  });

  it("skips a card whose content did not arrive", () => {
    const state = init({ limits: { c2: LIMIT, c3: LIMIT } });
    expect(currentCard(state)).toStrictEqual({ cardId: "c2", pass: "first", ask: 0 });
  });
});

describe("answers left unsaved by an earlier page", () => {
  function given(cardId: string, overrides: Partial<AnswerInput> = {}): AnswerInput {
    return {
      id: answerId("round-1", cardId, 0),
      roundId: "round-1",
      cardId,
      pass: "first",
      grade: "good",
      timedOut: false,
      elapsedMs: 900,
      ...overrides,
    };
  }
  const round = { id: "round-1", deck: ["c1", "c2", "c3"], answered: [] };

  it("keeps an answer of this round the server does not hold yet", () => {
    expect(unsavedAnswers([given("c1")], round)).toStrictEqual([given("c1")]);
  });

  it("leaves out an answer the server already holds, so it is not counted twice", () => {
    const held = { ...round, answered: [{ id: answerId("round-1", "c1", 0) }] };
    expect(unsavedAnswers([given("c1"), given("c2")], held)).toStrictEqual([
      given("c2"),
    ]);
  });

  it("keeps the first of two answers under one id, as the server does", () => {
    const later = given("c1", { grade: "again" });
    expect(unsavedAnswers([given("c1"), later], round)).toStrictEqual([given("c1")]);
  });

  it.each([
    ["another round", given("c1", { roundId: "round-0", id: "round-0:f:c1" })],
    ["a card the round no longer deals", given("c9")],
  ])("leaves out an answer of %s", (_, stored) => {
    expect(unsavedAnswers([stored], round)).toStrictEqual([]);
  });

  it("resumes past them, a miss among them not asked again", () => {
    const unsaved = unsavedAnswers(
      [given("c1", { grade: "again" }), given("c2")],
      round,
    );
    const state = init({ answered: unsaved });
    expect(currentCard(state)).toStrictEqual({ cardId: "c3", pass: "first", ask: 0 });
    expect(state.reAsks).toStrictEqual([]);
  });
});

describe("answer ids", () => {
  it("are fixed by round, card and showing, so a resend is recognised", () => {
    expect(answerId("r", "c", 0)).toBe("r:f:c");
    expect(answerId("r", "c", 1)).toBe("r:r1:c");
    expect(answerId("r", "c", 0)).not.toBe(answerId("r", "c", 1));
    expect(answerId("r", "c", 1)).not.toBe(answerId("r", "c", 2));
  });

  it("fit the API's 64-character bound for a UUID round, a card id and the tenth re-ask", () => {
    const id = answerId("123e4567-e89b-12d3-a456-426614174000", "c_2c4d3y8g", 10);
    expect(id.length).toBeLessThanOrEqual(64);
  });
});

describe("untimed card removal", () => {
  it("removes all re-asks and fresh occurrences of the current card without grading or erasing history", () => {
    const back = flipAfter({ ...init(), untimed: true }, 0, 1000);
    const recorded = grade(back, "again", 1200).answers;
    const state: DrillState = {
      ...back,
      fresh: ["c1", "c2", "c3"],
      answers: recorded,
      reAsks: [
        { cardId: "c1", due: 2 },
        { cardId: "c2", due: 100 },
        { cardId: "c1", due: 5 },
      ],
      paused: true,
    };
    const next = drillReducer(state, { type: "remove", cardId: "c1" });
    expect(currentCard(next)?.cardId).toBe("c2");
    expect(next.fresh).toStrictEqual(["c3"]);
    expect(next.reAsks).toStrictEqual([{ cardId: "c2", due: 100 }]);
    expect(next.answers).toBe(recorded);
    expect(next.phase.kind).toBe("front");
    expect(next.paused).toBe(false);
  });
  it("finishes when deleting the last card, without an answer", () => {
    const back = flipAfter({ ...init({ deck: ["c1"] }), untimed: true }, 0, 1000);
    const next = drillReducer(back, { type: "remove", cardId: "c1" });
    expect(next.phase.kind).toBe("finishing");
    expect(currentCard(next)).toBeUndefined();
    expect(next.answers).toStrictEqual([]);
  });
  it("rejects timed removal, a stale card id, the front and already graded feedback", () => {
    const timed = flipAfter(init(), 0, 1000);
    expect(drillReducer(timed, { type: "remove", cardId: "c1" })).toBe(timed);
    const back = { ...timed, untimed: true };
    expect(drillReducer(back, { type: "remove", cardId: "c2" })).toBe(back);
    const front = { ...init(), untimed: true };
    expect(drillReducer(front, { type: "remove", cardId: "c1" })).toBe(front);
    const feedback = grade(back, "good", 1500);
    expect(drillReducer(feedback, { type: "remove", cardId: "c1" })).toBe(feedback);
  });
});
