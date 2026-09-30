import { describe, expect, it } from "vitest";

import {
  recordAnswers,
  startRound,
  updateSettings,
  type RoundPayload,
} from "@instant-composition/application";
import type { AnswerMode } from "@instant-composition/domain";

import { answersFor, makeHarness, type Harness } from "./application-harness";

// Every card of the harness's catalog is eight words long: a spoken pace of
// ceil(4 + 8 * 0.5) = 8 seconds, a typed one of ceil(6 + 8 * 2) = 22 seconds.

async function onboard(h: Harness, answerMode?: AnswerMode): Promise<void> {
  const saved = await updateSettings(h.deps, h.context(), {
    topics: ["work", "travel"],
    ...(answerMode === undefined ? {} : { answerMode }),
  });
  expect(saved.ok).toBe(true);
}

async function start(h: Harness): Promise<RoundPayload> {
  const started = await startRound(h.deps, h.context(), {
    kind: "placement",
    roundId: "p1",
  });
  if (!started.ok) {
    throw new Error(`Starting failed with ${started.error.code}.`);
  }
  return started.value;
}

describe("a typed round", () => {
  it("is dealt from typed settings, recording the mode and no limit", async () => {
    const h = makeHarness();
    await onboard(h, "typed");
    const round = await start(h);

    const stored = await h.stores.forLearner(h.learner).round(round.id);
    expect(stored?.value.answerMode).toBe("typed");
    expect(stored !== undefined && "limitMs" in stored.value).toBe(false);
    expect(Object.values(round.cards)[0]).toMatchObject({
      limitMs: 600_000,
      paceMs: 22_000,
    });
  });

  it("refuses a batch holding a timeout, and writes none of it", async () => {
    const h = makeHarness();
    await onboard(h, "typed");
    const round = await start(h);
    const answers = answersFor(round, (_, index) => (index === 1 ? "timeout" : "ok"));

    expect(
      await recordAnswers(h.deps, h.context(), { roundId: round.id, answers }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_BAD_REQUEST" } });
    expect(await h.stores.forLearner(h.learner).reviewsOf(round.id)).toStrictEqual([]);
  });

  it("stores each answer with its mode, its text and its time held only to the cap", async () => {
    const h = makeHarness();
    await onboard(h, "typed");
    const round = await start(h);
    const [first, second] = answersFor(round);
    if (first === undefined || second === undefined) {
      throw new Error("The deck is too small.");
    }

    const recorded = await recordAnswers(h.deps, h.context(), {
      roundId: round.id,
      answers: [
        { ...first, elapsedMs: 90_000, text: "Let's get started." },
        { ...second, elapsedMs: 900_000 },
      ],
    });

    expect(recorded.ok).toBe(true);
    const reviews = await h.stores.forLearner(h.learner).reviewsOf(round.id);
    expect(reviews.map((review) => review.detail)).toStrictEqual([
      {
        activity: "composition",
        pass: "first",
        result: "ok",
        elapsedMs: 90_000,
        limitMs: 600_000,
        paceMs: 22_000,
        answerMode: "typed",
        text: "Let's get started.",
      },
      {
        activity: "composition",
        pass: "first",
        result: "ok",
        elapsedMs: 600_000,
        limitMs: 600_000,
        paceMs: 22_000,
        answerMode: "typed",
      },
    ]);
  });

  it("keeps its mode when the setting changes under it, so a queued answer meets the rule it was given under", async () => {
    const h = makeHarness();
    await onboard(h, "typed");
    const round = await start(h);
    expect(
      (await updateSettings(h.deps, h.context(), { answerMode: "spoken" })).ok,
    ).toBe(true);
    const [first] = answersFor(round);
    if (first === undefined) {
      throw new Error("The deck is too small.");
    }

    expect(
      await recordAnswers(h.deps, h.context(), {
        roundId: round.id,
        answers: [{ ...first, text: "Let's get started." }],
      }),
    ).toStrictEqual({ ok: true, value: undefined });
  });
});

describe("a spoken round", () => {
  it("is dealt to a learner who never chose a mode, with the limit and the spoken pace as before", async () => {
    const h = makeHarness();
    await onboard(h);
    const round = await start(h);

    const stored = await h.stores.forLearner(h.learner).round(round.id);
    expect(stored?.value).toMatchObject({ answerMode: "spoken", limitMs: 30_000 });
    expect(Object.values(round.cards)[0]).toMatchObject({
      limitMs: 30_000,
      paceMs: 8_000,
    });
  });

  it("holds an answer to the limit, takes a timeout, and refuses a text", async () => {
    const h = makeHarness();
    await onboard(h);
    const round = await start(h);
    const [first, second, third] = answersFor(round);
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("The deck is too small.");
    }

    expect(
      await recordAnswers(h.deps, h.context(), {
        roundId: round.id,
        answers: [{ ...third, text: "Let's get started." }],
      }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_BAD_REQUEST" } });
    expect(
      (
        await recordAnswers(h.deps, h.context(), {
          roundId: round.id,
          answers: [
            { ...first, elapsedMs: 90_000 },
            { ...second, result: "timeout", elapsedMs: 10 },
          ],
        })
      ).ok,
    ).toBe(true);

    const reviews = await h.stores.forLearner(h.learner).reviewsOf(round.id);
    expect(reviews.map((review) => review.detail)).toStrictEqual([
      {
        activity: "composition",
        pass: "first",
        result: "ok",
        elapsedMs: 30_000,
        limitMs: 30_000,
        paceMs: 8_000,
        answerMode: "spoken",
      },
      {
        activity: "composition",
        pass: "first",
        result: "timeout",
        elapsedMs: 30_000,
        limitMs: 30_000,
        paceMs: 8_000,
        answerMode: "spoken",
      },
    ]);
  });
});

describe("the settings view", () => {
  it("keeps to the /v1 contract, which carries no answer mode yet", async () => {
    const h = makeHarness();
    const saved = await updateSettings(h.deps, h.context(), {
      topics: ["work"],
      answerMode: "typed",
    });
    expect(saved.ok && "answerMode" in saved.value.settings).toBe(false);
    expect((await h.stores.forLearner(h.learner).settings())?.value.answerMode).toBe(
      "typed",
    );
  });
});
