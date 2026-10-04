import { describe, expect, it } from "vitest";
import { initStudy, studyReducer, type StudyState } from "@instant-composition/web";

function grade(state: StudyState, choice: "again" | "good"): StudyState {
  const shown = studyReducer(state, { type: "shown", at: 0 });
  const back = studyReducer(shown, { type: "flip", at: 1000 });
  return studyReducer(back, {
    type: "grade",
    grade: choice,
    at: 1200,
    wall: 5000,
    key: true,
  });
}

describe("study grading and re-ask completion as pure rules", () => {
  it("records one grade per back, re-asks a new again card until two good grades, then finishes", () => {
    const start = initStudy({
      sessionId: "s1",
      deck: ["c1"],
      isNew: { c1: true },
      answered: [],
      retries: true,
      intro: false,
    });
    const first = grade(start, "again");
    expect(first.answers).toMatchObject([
      { id: "s1:f:c1", grade: "again", pass: "first", elapsedMs: 1000 },
    ]);
    expect(
      studyReducer(first, {
        type: "grade",
        grade: "good",
        at: 1300,
        wall: 6000,
        key: true,
      }),
    ).toStrictEqual(first);
    const reask = studyReducer(first, { type: "advance", at: 1400 });
    expect(reask.card).toStrictEqual({ cardId: "c1", ask: 1, pass: "retry" });
    const good = grade(reask, "good");
    const again = studyReducer(good, { type: "advance", at: 1500 });
    expect(again.card).toStrictEqual({ cardId: "c1", ask: 2, pass: "retry" });
    const finished = studyReducer(grade(again, "good"), { type: "advance", at: 1600 });
    expect(finished.phase).toStrictEqual({ kind: "finishing" });
    expect(finished.answers.map(({ id }) => id)).toStrictEqual([
      "s1:f:c1",
      "s1:r1:c1",
      "s1:r2:c1",
    ]);
  });

  it("removes the last card only from its back and finishes without a fabricated answer", () => {
    const start = initStudy({
      sessionId: "s1",
      deck: ["c1"],
      isNew: { c1: true },
      answered: [],
      retries: true,
      intro: false,
    });
    expect(studyReducer(start, { type: "remove", cardId: "c1" })).toStrictEqual(start);
    const shown = studyReducer(start, { type: "shown", at: 0 });
    const back = studyReducer(shown, { type: "flip", at: 1000 });
    const removed = studyReducer(back, { type: "remove", cardId: "c1" });
    expect(removed.phase).toStrictEqual({ kind: "finishing" });
    expect(removed.answers).toStrictEqual([]);
  });
});
