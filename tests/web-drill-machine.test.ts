import { describe, expect, it } from "vitest";

import {
  answerId,
  currentCard,
  type DrillEvent,
  type DrillInit,
  drillReducer,
  type DrillState,
  initDrill,
  progress,
  remainingMs,
  unsavedAnswers,
  type AnswerInput,
} from "@instant-composition/web";

const LIMIT = 7000;
/** Each card's pace, which "fast" is judged by; equal to the limit unless a case says otherwise. */
const PACE = 7000;
/** The wall clock, in epoch ms, when the monotonic clock reads zero. */
const WALL = 1_790_000_000_000;

function init(overrides: Partial<DrillInit> = {}): DrillState {
  return initDrill({
    roundId: "round-1",
    deck: ["c1", "c2", "c3"],
    limits: { c1: LIMIT, c2: LIMIT, c3: LIMIT },
    paces: { c1: PACE, c2: PACE, c3: PACE },
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
  return run(
    state,
    { type: "shown", at },
    { type: "flip", at: at + elapsed, wall: WALL + (at + elapsed) },
  );
}

function grade(
  state: DrillState,
  result: "ok" | "ng",
  at: number,
  key = false,
): DrillState {
  return drillReducer(state, { type: "grade", result, at, wall: WALL + at, key });
}

/** Grades the current card `result` by pointer and moves on past the feedback. */
function answer(state: DrillState, at: number, result: "ok" | "ng"): DrillState {
  const back = flipAfter(state, at, 2000);
  return drillReducer(grade(back, result, at + 3000), {
    type: "advance",
    at: at + 3500,
  });
}

function timeOut(state: DrillState, at: number): DrillState {
  return run(
    state,
    { type: "shown", at },
    { type: "tick", at: at + LIMIT, wall: WALL + (at + LIMIT) },
    { type: "next", at: at + LIMIT + 1000 },
  );
}

describe("starting a drill", () => {
  it("opens on the first card's front with its clock not yet running", () => {
    const state = init();
    expect(currentCard(state)).toStrictEqual({ cardId: "c1", pass: "first" });
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
    expect(
      drillReducer(state, { type: "flip", at: 5, wall: WALL + 5 }).phase.kind,
    ).toBe("intro");
    expect(drillReducer(state, { type: "start", at: 5 }).phase.kind).toBe("front");
  });
});

describe("the front's clock", () => {
  it("runs from the moment the front is shown", () => {
    const state = run(
      init(),
      { type: "shown", at: 1000 },
      { type: "tick", at: 3500, wall: WALL + 3500 },
    );
    expect(remainingMs(state)).toBe(LIMIT - 2500);
  });

  it("ignores a flip before the front was shown", () => {
    const state = drillReducer(init(), { type: "flip", at: 10, wall: WALL + 10 });
    expect(state.phase.kind).toBe("front");
  });

  it("flips to the learner's back with the seconds it took, recording nothing yet", () => {
    const state = flipAfter(init(), 1000, 2800);
    expect(state.phase).toMatchObject({ kind: "back", mode: "self", elapsedMs: 2800 });
    expect(state.answers).toStrictEqual([]);
  });

  it("times out on the tick that reaches the limit and records a timeout", () => {
    const shown = drillReducer(init(), { type: "shown", at: 0 });
    expect(
      drillReducer(shown, { type: "tick", at: LIMIT - 1, wall: WALL + (LIMIT - 1) })
        .phase.kind,
    ).toBe("front");
    const state = drillReducer(shown, {
      type: "tick",
      at: LIMIT + 40,
      wall: WALL + (LIMIT + 40),
    });
    expect(state.phase).toMatchObject({ kind: "back", mode: "timeout" });
    expect(state.answers).toStrictEqual([
      {
        id: answerId("round-1", "first", "c1"),
        roundId: "round-1",
        cardId: "c1",
        pass: "first",
        result: "timeout",
        elapsedMs: LIMIT,
        answeredAt: WALL + LIMIT + 40,
      },
    ]);
  });

  it("treats a flip that comes after the limit as a timeout", () => {
    const state = flipAfter(init(), 0, LIMIT + 5);
    expect(state.phase).toMatchObject({ kind: "back", mode: "timeout" });
    expect(state.answers[0]?.result).toBe("timeout");
  });
});

describe("grading a back", () => {
  it("ignores a grade key for 150 ms after the back appears", () => {
    const back = flipAfter(init(), 0, 2000);
    expect(grade(back, "ok", 2149, true).phase.kind).toBe("back");
    expect(grade(back, "ok", 2150, true).phase.kind).toBe("feedback");
  });

  it("accepts a pressed button at once", () => {
    const back = flipAfter(init(), 0, 2000);
    expect(grade(back, "ok", 2001).phase.kind).toBe("feedback");
  });

  it("records ○, counts the combo and marks a flip within half the pace as fast", () => {
    const state = grade(flipAfter(init(), 0, 2100), "ok", 3000);
    expect(state.phase).toStrictEqual({
      kind: "feedback",
      result: "ok",
      fast: true,
      elapsedMs: 2100,
    });
    expect(state.combo).toBe(1);
    expect(state.answers).toStrictEqual([
      {
        id: answerId("round-1", "first", "c1"),
        roundId: "round-1",
        cardId: "c1",
        pass: "first",
        result: "ok",
        elapsedMs: 2100,
        answeredAt: WALL + 3000,
      },
    ]);
  });

  it("reports each answer as given at the wall-clock time of its grade, not of its flip", () => {
    const back = flipAfter(init(), 0, 2100);
    const graded = drillReducer(back, {
      type: "grade",
      result: "ng",
      at: 5000,
      wall: 1_800_000_000_123,
      key: false,
    });
    expect(graded.answers.map((recorded) => recorded.answeredAt)).toStrictEqual([
      1_800_000_000_123,
    ]);
  });

  it("does not call a flip past half the pace fast", () => {
    const state = grade(flipAfter(init(), 0, 3600), "ok", 4000);
    expect(state.phase).toMatchObject({ fast: false });
  });

  it("judges fast against the card's pace, not a longer limit the round was dealt with", () => {
    const long = init({ limits: { c1: 60_000, c2: 60_000, c3: 60_000 } });
    expect(grade(flipAfter(long, 0, 3600), "ok", 4000).phase).toMatchObject({
      fast: false,
    });
    expect(grade(flipAfter(long, 0, 3500), "ok", 4000).phase).toMatchObject({
      fast: true,
    });
  });

  it("moves on to the next front once the feedback is over", () => {
    const state = answer(init(), 0, "ok");
    expect(currentCard(state)).toStrictEqual({ cardId: "c2", pass: "first" });
    expect(state.phase).toMatchObject({ kind: "front", runningSince: null });
  });

  it("breaks the combo on ×", () => {
    const twice = answer(answer(init(), 0, "ok"), 10_000, "ok");
    expect(twice.combo).toBe(2);
    const broken = grade(flipAfter(twice, 20_000, 1000), "ng", 22_000);
    expect(broken.combo).toBe(0);
    expect(broken.phase).toMatchObject({ kind: "feedback", result: "ng" });
    expect(broken.answers.at(-1)?.result).toBe("ng");
  });

  it("breaks the combo on a timeout", () => {
    const state = run(answer(init(), 0, "ok"), { type: "shown", at: 10_000 });
    expect(
      drillReducer(state, {
        type: "tick",
        at: 10_000 + LIMIT,
        wall: WALL + (10_000 + LIMIT),
      }).combo,
    ).toBe(0);
  });

  it("offers only next on a timed-out back", () => {
    const back = run(
      init(),
      { type: "shown", at: 0 },
      { type: "tick", at: LIMIT, wall: WALL + LIMIT },
    );
    expect(grade(back, "ok", LIMIT + 1000).phase.kind).toBe("back");
    const next = drillReducer(back, { type: "next", at: LIMIT + 1000 });
    expect(currentCard(next)).toStrictEqual({ cardId: "c2", pass: "first" });
  });

  it("ignores next on a back the learner flipped", () => {
    const back = flipAfter(init(), 0, 2000);
    expect(drillReducer(back, { type: "next", at: 3000 }).phase.kind).toBe("back");
  });
});

describe("pausing", () => {
  it("stops the clock and resumes from what was left", () => {
    const paused = run(
      init(),
      { type: "shown", at: 0 },
      { type: "pause", at: 3000 },
      { type: "tick", at: 60_000, wall: WALL + 60_000 },
    );
    expect(paused.paused).toBe(true);
    expect(paused.phase.kind).toBe("front");
    expect(remainingMs(paused)).toBe(LIMIT - 3000);

    const resumed = run(
      paused,
      { type: "resume", at: 100_000 },
      { type: "tick", at: 103_000, wall: WALL + 103_000 },
    );
    expect(remainingMs(resumed)).toBe(1000);
    expect(
      drillReducer(resumed, { type: "tick", at: 104_000, wall: WALL + 104_000 }).phase,
    ).toMatchObject({
      kind: "back",
      mode: "timeout",
    });
  });

  it("pauses when the page is hidden, and keeps the combo on resume", () => {
    const state = run(answer(init(), 0, "ok"), { type: "shown", at: 10_000 });
    const hidden = drillReducer(state, { type: "hide", at: 11_000 });
    expect(hidden.paused).toBe(true);
    const resumed = drillReducer(hidden, { type: "resume", at: 50_000 });
    expect(resumed.paused).toBe(false);
    expect(resumed.combo).toBe(1);
  });

  it("ignores flips and grades while paused", () => {
    const front = run(init(), { type: "shown", at: 0 }, { type: "pause", at: 100 });
    expect(
      drillReducer(front, { type: "flip", at: 200, wall: WALL + 200 }).phase.kind,
    ).toBe("front");
    const back = run(flipAfter(init(), 0, 1000), { type: "pause", at: 1500 });
    expect(grade(back, "ok", 3000).phase.kind).toBe("back");
  });

  it("restarts the grade-key lock when a paused back resumes", () => {
    const back = run(
      flipAfter(init(), 0, 1000),
      { type: "pause", at: 1500 },
      { type: "resume", at: 9000 },
    );
    expect(grade(back, "ok", 9100, true).phase.kind).toBe("back");
    expect(grade(back, "ok", 9150, true).phase.kind).toBe("feedback");
  });

  it("finishes the feedback while paused but holds the next clock until resume", () => {
    const feedback = run(grade(flipAfter(init(), 0, 1000), "ok", 1500), {
      type: "pause",
      at: 1600,
    });
    const next = run(
      feedback,
      { type: "advance", at: 1800 },
      { type: "shown", at: 1810 },
      { type: "tick", at: 30_000, wall: WALL + 30_000 },
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

describe("the retry pass", () => {
  it("brings back × and timeouts in the order they came, marked as retries", () => {
    let state = answer(init(), 0, "ng");
    state = answer(state, 10_000, "ok");
    state = timeOut(state, 20_000);
    expect(currentCard(state)).toStrictEqual({ cardId: "c1", pass: "retry" });
    expect(progress(state)).toStrictEqual({ pass: "retry", position: 1, total: 2 });

    state = answer(state, 30_000, "ng");
    expect(currentCard(state)).toStrictEqual({ cardId: "c3", pass: "retry" });
    state = answer(state, 40_000, "ok");
    expect(state.phase.kind).toBe("finishing");
    expect(state.answers.map((a) => [a.cardId, a.pass, a.result])).toStrictEqual([
      ["c1", "first", "ng"],
      ["c2", "first", "ok"],
      ["c3", "first", "timeout"],
      ["c1", "retry", "ng"],
      ["c3", "retry", "ok"],
    ]);
  });

  it("is skipped by a placement round", () => {
    let state = init({ retries: false });
    state = answer(state, 0, "ng");
    state = answer(state, 10_000, "ok");
    state = answer(state, 20_000, "ng");
    expect(state.phase.kind).toBe("finishing");
  });

  it("is skipped when every card was said", () => {
    let state = init();
    for (const at of [0, 10_000, 20_000]) state = answer(state, at, "ok");
    expect(state.phase.kind).toBe("finishing");
  });
});

describe("resuming a round", () => {
  it("picks up after the answered cards with the combo at 0", () => {
    const state = init({
      deck: ["c1", "c2", "c3"],
      answered: [
        { cardId: "c1", pass: "first", result: "ng" },
        { cardId: "c2", pass: "first", result: "ok" },
      ],
    });
    expect(currentCard(state)).toStrictEqual({ cardId: "c3", pass: "first" });
    expect(progress(state)).toStrictEqual({ pass: "first", position: 3, total: 3 });
    expect(state.combo).toBe(0);
    expect(state.retryPile).toStrictEqual(["c1"]);
  });

  it("resumes inside the retry pass", () => {
    const state = init({
      answered: [
        { cardId: "c1", pass: "first", result: "ng" },
        { cardId: "c2", pass: "first", result: "timeout" },
        { cardId: "c3", pass: "first", result: "ok" },
        { cardId: "c1", pass: "retry", result: "ok" },
      ],
    });
    expect(currentCard(state)).toStrictEqual({ cardId: "c2", pass: "retry" });
    expect(progress(state)).toStrictEqual({ pass: "retry", position: 2, total: 2 });
  });

  it("goes straight to finishing when nothing is left", () => {
    const state = init({
      answered: ["c1", "c2", "c3"].map((cardId) => ({
        cardId,
        pass: "first" as const,
        result: "ok" as const,
      })),
    });
    expect(state.phase.kind).toBe("finishing");
    expect(currentCard(state)).toBeUndefined();
    expect(remainingMs(state)).toBeUndefined();
  });

  it("skips a card whose content did not arrive", () => {
    const state = init({ limits: { c2: LIMIT, c3: LIMIT } });
    expect(currentCard(state)).toStrictEqual({ cardId: "c2", pass: "first" });
  });
});

describe("answers left unsaved by an earlier page", () => {
  function given(cardId: string, overrides: Partial<AnswerInput> = {}): AnswerInput {
    return {
      id: answerId("round-1", "first", cardId),
      roundId: "round-1",
      cardId,
      pass: "first",
      result: "ok",
      elapsedMs: 900,
      ...overrides,
    };
  }
  const round = { id: "round-1", deck: ["c1", "c2", "c3"], answered: [] };

  it("keeps an answer of this round the server does not hold yet", () => {
    expect(unsavedAnswers([given("c1")], round)).toStrictEqual([given("c1")]);
  });

  it("leaves out an answer the server already holds, so it is not counted twice", () => {
    const held = { ...round, answered: [{ id: answerId("round-1", "first", "c1") }] };
    expect(unsavedAnswers([given("c1"), given("c2")], held)).toStrictEqual([
      given("c2"),
    ]);
  });

  it("keeps the first of two answers under one id, as the server does", () => {
    const later = given("c1", { result: "ng" });
    expect(unsavedAnswers([given("c1"), later], round)).toStrictEqual([given("c1")]);
  });

  it.each([
    ["another round", given("c1", { roundId: "round-0", id: "round-0:f:c1" })],
    ["a card the round no longer deals", given("c9")],
  ])("leaves out an answer of %s", (_, stored) => {
    expect(unsavedAnswers([stored], round)).toStrictEqual([]);
  });

  it("resumes past them, a miss among them waiting in the retry pile", () => {
    const unsaved = unsavedAnswers([given("c1", { result: "ng" }), given("c2")], round);
    const state = init({ answered: unsaved });
    expect(currentCard(state)).toStrictEqual({ cardId: "c3", pass: "first" });
    expect(state.retryPile).toStrictEqual(["c1"]);
  });
});

describe("answer ids", () => {
  it("are fixed by round, pass and card, so a resend is recognised", () => {
    expect(answerId("r", "first", "c")).toBe(answerId("r", "first", "c"));
    expect(answerId("r", "first", "c")).not.toBe(answerId("r", "retry", "c"));
  });

  it("fit the API's 64-character bound for a UUID round and a card id", () => {
    const id = answerId("123e4567-e89b-12d3-a456-426614174000", "retry", "c_2c4d3y8g");
    expect(id.length).toBeLessThanOrEqual(64);
  });
});

describe("a typed round", () => {
  /** A typed round's cap, which every typed card carries as its limit. */
  const CAP = 600_000;

  function typed(overrides: Partial<DrillInit> = {}): DrillState {
    return init({
      limits: { c1: CAP, c2: CAP, c3: CAP },
      typed: true,
      ...overrides,
    });
  }

  function submit(state: DrillState, text: string, at: number): DrillState {
    return drillReducer(state, { type: "submit", text, at });
  }

  it("never times out, however long the front is shown", () => {
    const state = run(
      typed(),
      { type: "shown", at: 0 },
      { type: "tick", at: CAP + 5000, wall: WALL + CAP + 5000 },
    );
    expect(state.phase.kind).toBe("front");
    expect(state.answers).toStrictEqual([]);
  });

  it("does not flip: only a submission turns the card over", () => {
    const state = flipAfter(typed(), 0, 2000);
    expect(state.phase.kind).toBe("front");
  });

  it("turns over on a submission with the text and the time from the front being shown", () => {
    const shown = drillReducer(typed(), { type: "shown", at: 1000 });
    expect(submit(shown, "  I'd like to push it back.  ", 5200).phase).toStrictEqual({
      kind: "back",
      mode: "self",
      elapsedMs: 4200,
      since: 5200,
      text: "I'd like to push it back.",
    });
  });

  it.each([
    ["an empty field", ""],
    ["a field of spaces", "   "],
  ])("turns over on %s with no text", (_, text) => {
    const shown = drillReducer(typed(), { type: "shown", at: 0 });
    const back = submit(shown, text, 3000);
    expect(back.phase).toStrictEqual({
      kind: "back",
      mode: "self",
      elapsedMs: 3000,
      since: 3000,
    });
    const graded = grade(back, "ng", 4000);
    expect(graded.answers[0]).not.toHaveProperty("text");
  });

  it("ignores a submission before the front was shown", () => {
    expect(submit(typed(), "Hi.", 10).phase.kind).toBe("front");
  });

  it("leaves time paused out of the elapsed time", () => {
    const state = run(
      typed(),
      { type: "shown", at: 0 },
      { type: "pause", at: 2000 },
      { type: "resume", at: 60_000 },
      { type: "submit", text: "Hi.", at: 61_000 },
    );
    expect(state.phase).toMatchObject({ kind: "back", elapsedMs: 3000 });
  });

  it("holds the elapsed time to the round's cap", () => {
    const shown = drillReducer(typed(), { type: "shown", at: 0 });
    expect(submit(shown, "Hi.", CAP + 90_000).phase).toMatchObject({
      elapsedMs: CAP,
    });
  });

  it("records the grade with the text typed, and keeps the text through its feedback", () => {
    const shown = drillReducer(typed(), { type: "shown", at: 0 });
    const state = grade(submit(shown, "Can we move it?", 2000), "ok", 2500);
    expect(state.phase).toStrictEqual({
      kind: "feedback",
      result: "ok",
      fast: true,
      elapsedMs: 2000,
      text: "Can we move it?",
    });
    expect(state.answers).toStrictEqual([
      {
        id: answerId("round-1", "first", "c1"),
        roundId: "round-1",
        cardId: "c1",
        pass: "first",
        result: "ok",
        elapsedMs: 2000,
        answeredAt: WALL + 2500,
        text: "Can we move it?",
      },
    ]);
  });

  it("ignores a submission in a spoken round", () => {
    const shown = drillReducer(init(), { type: "shown", at: 0 });
    expect(submit(shown, "Hi.", 1000)).toBe(shown);
  });

  describe("reopened after the page went away", () => {
    const submitted = {
      cardId: "c1",
      pass: "first",
      elapsedMs: 4200,
      text: "Hi.",
    } as const;

    it("opens on the back of the card submitted and not graded, with its text", () => {
      expect(typed({ intro: true, submitted }).phase).toStrictEqual({
        kind: "back",
        mode: "self",
        elapsedMs: 4200,
        since: 0,
        text: "Hi.",
      });
    });

    it("opens on a back with no text when none was typed", () => {
      const blank = { cardId: "c1", pass: "first", elapsedMs: 4200 } as const;
      expect(typed({ submitted: blank }).phase).toStrictEqual({
        kind: "back",
        mode: "self",
        elapsedMs: 4200,
        since: 0,
      });
    });

    it.each([
      ["another card", { ...submitted, cardId: "c2" }],
      ["another pass", { ...submitted, pass: "retry" as const }],
    ])("opens on the front when the submission was for %s", (_, other) => {
      expect(typed({ submitted: other }).phase.kind).toBe("front");
    });

    it("ignores a submission in a spoken round", () => {
      expect(init({ submitted }).phase.kind).toBe("front");
    });
  });
});
