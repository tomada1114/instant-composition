import { describe, expect, it } from "vitest";

import {
  finishRound,
  history,
  home,
  recordAnswers,
  records,
  roundSummary,
  settingsPage,
  startRound,
  updateSettings,
  learnerId,
  type ApplicationDeps,
  type RequestContext,
} from "@instant-composition/application";

import {
  answersFor,
  DAY_MS,
  makeHarness,
  NOON,
  unreadableCatalog,
  type Harness,
} from "./application-harness";

async function started(
  h: Harness,
  kind: "placement" | "today",
  roundId: string,
  now: number,
) {
  const round = await startRound(h.deps, h.context(now), { kind, roundId });
  if (!round.ok) throw new Error(round.error.code);
  return round.value;
}

/** A placement of ten answers on the first day. */
async function placed(h: Harness, dailySize: 10 | 30 = 10): Promise<void> {
  await updateSettings(h.deps, h.context(), { topics: ["work", "travel"], dailySize });
  const round = await started(h, "placement", "p0", NOON);
  await finishRound(h.deps, h.context(), {
    roundId: round.id,
    answers: answersFor(round),
  });
}

/** The placement, then a day's portion of thirty, missed and retried unless `said`, on each of `days` days. */
async function practiced(h: Harness, days: number, said = false): Promise<number> {
  await placed(h, 30);
  let now = NOON;
  for (let day = 1; day <= days; day += 1) {
    now = NOON + day * DAY_MS;
    const round = await started(h, "today", `t${String(day)}`, now);
    const firsts = answersFor(round, () => (said ? "ok" : "ng"));
    const retries = (said ? [] : firsts).map((answer) => ({
      ...answer,
      id: `${round.id}:r:${answer.cardId}`,
      pass: "retry" as const,
      result: "ok" as const,
    }));
    await finishRound(h.deps, h.context(now), {
      roundId: round.id,
      answers: [...firsts, ...retries],
    });
  }
  return now;
}

type Query = (deps: ApplicationDeps, context: RequestContext) => Promise<unknown>;

const QUERIES: Readonly<Record<string, Query>> = {
  home,
  records,
  roundSummary: (deps, context) => roundSummary(deps, context, "p0"),
  settingsPage,
  history,
};

async function readsOf(h: Harness, query: Query, now: number): Promise<number> {
  const before = h.stores.readCount();
  await query(h.deps, h.context(now));
  return h.stores.readCount() - before;
}

describe("every query", () => {
  it.each(Object.entries(QUERIES))(
    "%s reads as much after 1,000 answers as after 10",
    async (_, query) => {
      const few = makeHarness();
      await placed(few);
      const many = makeHarness();
      const now = await practiced(many, 17);

      expect(
        (await many.stores.forLearner(many.learner).reviews()).length,
      ).toBeGreaterThanOrEqual(1_000);
      expect(await few.stores.forLearner(few.learner).reviews()).toHaveLength(10);
      expect(await readsOf(many, query, now)).toBe(await readsOf(few, query, NOON));
    },
    30_000,
  );

  it.each(Object.entries(QUERIES))(
    "%s refuses an agent that was not granted it",
    async (_, query) => {
      const h = makeHarness();
      const context = {
        ...h.context(),
        actor: { kind: "agent" as const, onBehalfOf: h.learner, grants: [] },
      };
      expect(await query(h.deps, context)).toStrictEqual({
        ok: false,
        error: { code: "ERR_FORBIDDEN" },
      });
    },
  );
});

describe("home", () => {
  async function stateOf(h: Harness, now = NOON): Promise<string | undefined> {
    const view = await home(h.deps, h.context(now));
    return view.ok ? view.value.state.kind : undefined;
  }

  it("walks a learner from onboarding through placement to a finished day", async () => {
    const h = makeHarness();
    expect(await stateOf(h)).toBe("onboarding");
    await updateSettings(h.deps, h.context(), { topics: ["work"] });
    expect(await stateOf(h)).toBe("placement");
    const round = await started(h, "placement", "p0", NOON);
    await finishRound(h.deps, h.context(), {
      roundId: round.id,
      answers: answersFor(round),
    });
    expect(await stateOf(h)).toBe("done");
    expect(await stateOf(h, NOON + DAY_MS)).toBe("ready");
  });

  it("previews today's portion, and counts today's rounds and cards", async () => {
    const h = makeHarness();
    await placed(h);
    const tomorrow = NOON + DAY_MS;

    const ready = await home(h.deps, h.context(tomorrow));
    const today = await home(h.deps, h.context());

    expect(ready.ok && ready.value.preview).toMatchObject({
      size: 10,
      setting: 10,
      shortage: false,
      minutes: 5,
    });
    expect(ready.ok && ready.value.week.map((dot) => dot.state)).toContain("done");
    expect(today.ok && today.value).toMatchObject({
      todayRounds: 1,
      todayCards: 10,
      preview: undefined,
    });
  });

  it("names today's last finished round, and none on a day with none", async () => {
    const h = makeHarness();
    const lastRoundOf = async (now: number) => {
      const view = await home(h.deps, h.context(now));
      return view.ok ? view.value.todayLastRoundId : "not ok";
    };
    expect(await lastRoundOf(NOON)).toBeUndefined();

    const later = await practiced(h, 1);

    expect(await lastRoundOf(NOON)).toBe("p0");
    expect(await lastRoundOf(later)).toBe("t1");
    expect(await lastRoundOf(later + DAY_MS)).toBeUndefined();
  });

  it("shows a round under way", async () => {
    const h = makeHarness();
    await placed(h);
    const tomorrow = NOON + DAY_MS;
    const round = await started(h, "today", "t1", tomorrow);
    await recordAnswers(h.deps, h.context(tomorrow), {
      roundId: round.id,
      answers: answersFor(round).slice(0, 3),
    });

    const view = await home(h.deps, h.context(tomorrow));

    expect(view.ok && view.value.state).toMatchObject({
      kind: "in-progress",
      progress: 3,
      target: 10,
      resumeKind: "today",
    });
  });

  it("offers to make up yesterday when it was missed after a completed day", async () => {
    const h = makeHarness();
    await placed(h);
    const view = await home(h.deps, h.context(NOON + 2 * DAY_MS));
    expect(view.ok && view.value.state.kind).toBe("recover-offer");
    expect(view.ok && view.value.preview?.minutes).toBe(10);
  });

  it("still draws the screen when the catalog cannot be read", async () => {
    const h = makeHarness(unreadableCatalog);
    const view = await home(h.deps, h.context());
    expect(view.ok && view.value).toMatchObject({
      contentError: true,
      state: { kind: "onboarding" },
    });
  });
});

describe("roundSummary", () => {
  it("reads back the summary a finished round kept, on a later day too", async () => {
    const h = makeHarness();
    await updateSettings(h.deps, h.context(), { topics: ["work"] });
    const round = await started(h, "placement", "p0", NOON);
    const finished = await finishRound(h.deps, h.context(), {
      roundId: round.id,
      answers: answersFor(round),
    });

    expect(finished.ok).toBe(true);
    expect(
      await roundSummary(h.deps, h.context(NOON + 3 * DAY_MS), "p0"),
    ).toStrictEqual(finished);
  });

  it("does not find a round that is open, or one there is no such id for", async () => {
    const h = makeHarness();
    await updateSettings(h.deps, h.context(), { topics: ["work"] });
    await started(h, "placement", "p0", NOON);
    const notFound = { ok: false, error: { code: "ERR_ROUND_NOT_FOUND" } };

    expect(await roundSummary(h.deps, h.context(), "p0")).toStrictEqual(notFound);
    expect(await roundSummary(h.deps, h.context(), "missing")).toStrictEqual(notFound);
  });

  it("does not find another learner's finished round", async () => {
    const h = makeHarness();
    await placed(h);
    const other = learnerId("learner-b");
    const context: RequestContext = {
      ...h.context(),
      actor: { kind: "learner", learnerId: other },
      learner: { ...h.context().learner, id: other },
    };

    expect(await roundSummary(h.deps, context, "p0")).toStrictEqual({
      ok: false,
      error: { code: "ERR_ROUND_NOT_FOUND" },
    });
  });
});

describe("records", () => {
  it("shows the totals, the run and the calendar", async () => {
    const h = makeHarness();
    await placed(h);
    const view = await records(h.deps, h.context());
    expect(view.ok && view.value).toMatchObject({
      said: 10,
      practicedDays: 1,
      points: 20,
      toeic: "1000",
      streak: { current: 1, longest: 1 },
      titles: [],
    });
    expect(view.ok && view.value.calendar).toHaveLength(12);
    expect(view.ok && view.value.breakdown.map((topic) => topic.id)).toStrictEqual([
      "work",
      "travel",
    ]);
  });

  it("counts mastered cards by topic and subtopic, and groups the titles they earned", async () => {
    const h = makeHarness();
    const now = await practiced(h, 5, true);
    const view = await records(h.deps, h.context(now));
    const mastered = view.ok
      ? view.value.reach.topics.reduce((sum, topic) => sum + topic.count, 0)
      : 0;
    const broken = view.ok
      ? view.value.breakdown
          .flatMap((topic) => topic.subtopics)
          .reduce((sum, sub) => sum + sub.count, 0)
      : -1;

    expect(mastered).toBeGreaterThan(0);
    expect(broken).toBe(mastered);
    expect(view.ok && view.value.titles.length).toBeGreaterThan(0);
  });
});

describe("settingsPage", () => {
  it("shows the defaults and the taxonomy before any settings, and no level", async () => {
    const h = makeHarness();
    const view = await settingsPage(h.deps, h.context());
    expect(view.ok && view.value).toMatchObject({
      settings: { topics: [], dailySize: 10, sound: true },
      toeic: null,
    });
    expect(view.ok && view.value.topics.map((topic) => topic.id)).toStrictEqual([
      "work",
      "travel",
    ]);
  });
});

describe("history", () => {
  it("lists the cards seen, the choices and the level", async () => {
    const h = makeHarness();
    await placed(h);
    await updateSettings(h.deps, h.context(), {
      focus: [{ topic: "work", subtopic: "a" }],
    });
    const view = await history(h.deps, h.context());
    expect(view.ok && view.value).toMatchObject({
      topics: ["work", "travel"],
      focusSubtopics: ["work/a"],
      estimatedLevel: 10,
    });
    expect(view.ok && view.value.seenIds).toHaveLength(10);
  });
});
