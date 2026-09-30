import { describe, expect, it } from "vitest";

import {
  finishRound,
  recordAnswers,
  roundPayload,
  roundSummary,
  settingsPage,
  startRound,
  updateSettings,
  type RoundPayload,
} from "@instant-composition/application";
import type { AnswerMode } from "@instant-composition/domain";

import { answersFor, makeHarness, NOON, type Harness } from "./application-harness";

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
  it("shows the mode chosen, and spoken to a learner who never chose one", async () => {
    const h = makeHarness();
    await onboard(h);
    const before = await settingsPage(h.deps, h.context());
    const saved = await updateSettings(h.deps, h.context(), { answerMode: "typed" });
    const after = await settingsPage(h.deps, h.context());

    expect(before.ok && before.value.settings.answerMode).toBe("spoken");
    expect(saved.ok && saved.value.settings.answerMode).toBe("typed");
    expect(after.ok && after.value.settings.answerMode).toBe("typed");
  });
});

describe("a round read back", () => {
  it("carries the mode it was dealt with and the text typed for each answer, after the setting changed", async () => {
    const h = makeHarness();
    await onboard(h, "typed");
    const round = await start(h);
    const [first, second] = answersFor(round);
    if (first === undefined || second === undefined) {
      throw new Error("The deck is too small.");
    }
    await recordAnswers(h.deps, h.context(), {
      roundId: round.id,
      answers: [{ ...first, text: "Let's get started." }, second],
    });
    await updateSettings(h.deps, h.context(), { answerMode: "spoken" });

    const read = await roundPayload(h.deps, h.context(), round.id);

    expect(round.answerMode).toBe("typed");
    expect(read.ok && read.value.answerMode).toBe("typed");
    // Both were given at NOON, so the log orders them by id.
    const byId = <T extends { readonly id: string }>(rows: readonly T[]): T[] =>
      [...rows].sort((a, b) => a.id.localeCompare(b.id));
    expect(read.ok && byId(read.value.answered)).toStrictEqual(
      byId([
        {
          id: first.id,
          cardId: first.cardId,
          pass: "first",
          result: "ok",
          answeredAt: NOON,
          text: "Let's get started.",
        },
        {
          id: second.id,
          cardId: second.cardId,
          pass: "first",
          result: "ok",
          answeredAt: NOON,
        },
      ]),
    );
  });

  it("carries the spoken mode for a round dealt before the mode existed", async () => {
    const h = makeHarness();
    await onboard(h);
    const round = await start(h);
    const store = h.stores.forLearner(h.learner);
    const stored = await store.round(round.id);
    if (stored === undefined) {
      throw new Error("The round was not stored.");
    }
    const before = { ...stored.value };
    Reflect.deleteProperty(before, "answerMode");
    await store.commit({
      puts: [],
      updates: [{ entry: { type: "round", value: before }, version: stored.version }],
      expect: [],
    });

    const read = await roundPayload(h.deps, h.context(), round.id);

    expect(read.ok && read.value.answerMode).toBe("spoken");
  });
});

describe("a typed round's summary", () => {
  it("carries the mode and the text typed, the same when finished again and when read", async () => {
    const h = makeHarness();
    await onboard(h, "typed");
    const round = await start(h);
    const answers = answersFor(round, (_, index) => (index === 0 ? "ng" : "ok")).map(
      (answer, index) => (index === 0 ? { ...answer, text: "Let start." } : answer),
    );

    const finished = await finishRound(h.deps, h.context(), {
      roundId: round.id,
      answers,
    });
    const again = await finishRound(h.deps, h.context(), {
      roundId: round.id,
      answers,
    });
    const read = await roundSummary(h.deps, h.context(), round.id);

    if (!finished.ok) {
      throw new Error(`Finishing failed with ${finished.error.code}.`);
    }
    expect(finished.value.answerMode).toBe("typed");
    const [missed] = answers;
    const typed = finished.value.answered.filter((row) => row.id === missed?.id);
    expect(typed).toStrictEqual([
      {
        id: missed?.id,
        cardId: missed?.cardId,
        pass: "first",
        result: "ng",
        answeredAt: NOON,
        text: "Let start.",
      },
    ]);
    expect(
      finished.value.answered.filter((row) => "text" in row).map((row) => row.id),
    ).toStrictEqual([missed?.id]);
    expect(finished.value.answered).toHaveLength(answers.length);
    expect(again).toStrictEqual(finished);
    expect(read).toStrictEqual(finished);
  });
});
