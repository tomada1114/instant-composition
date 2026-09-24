import {
  finishRound,
  history,
  home,
  recordAnswers,
  roundSummary,
  records,
  settingsPage,
  startRound,
  updateSettings,
  type ApplicationErrorCode,
  type History,
  type HomeView,
  type RecordsView,
  type RoundPayload,
  type RoundSummary,
  type SettingsPageView,
  type SettingsView,
} from "@instant-composition/application";
import {
  answerSchema,
  answersRequestSchema,
  historySchema,
  homeViewSchema,
  MAX_ROUND_ANSWERS,
  recordsViewSchema,
  roundIdParamSchema,
  roundPayloadSchema,
  roundSummarySchema,
  settingsPageViewSchema,
  settingsPatchSchema,
  settingsViewSchema,
  startRoundRequestSchema,
  type ErrorCode,
} from "@instant-composition/contracts";
import {
  TUNING,
  type AnswerInput,
  type SettingsPatch,
  type StartCommand,
} from "@instant-composition/domain";
import { describe, expect, expectTypeOf, it } from "vitest";
import type * as z from "zod";

import {
  answersFor,
  DAY_MS,
  makeHarness,
  NOON,
  type Harness,
} from "./application-harness";

/**
 * A type as it reaches a client through `JSON.stringify`: arrays lose
 * `readonly`, and a property that may be `undefined` may be absent instead.
 * Comparing a schema with `Wire<View>` both ways is what makes a field added
 * to either side, or a type changed on either side, fail to compile.
 */
type Wire<T> = T extends readonly (infer U)[]
  ? Wire<U>[]
  : T extends object
    ? { [K in keyof T as undefined extends T[K] ? never : K]: Wire<T[K]> } & {
        [K in keyof T as undefined extends T[K] ? K : never]?: Wire<
          Exclude<T[K], undefined>
        >;
      }
    : T;

describe("each response schema mirrors the application view it serves", () => {
  it("RoundPayload, RoundSummary and SettingsView", () => {
    expectTypeOf<Wire<RoundPayload>>().toExtend<z.infer<typeof roundPayloadSchema>>();
    expectTypeOf<z.infer<typeof roundPayloadSchema>>().toExtend<Wire<RoundPayload>>();
    expectTypeOf<Wire<RoundSummary>>().toExtend<z.infer<typeof roundSummarySchema>>();
    expectTypeOf<z.infer<typeof roundSummarySchema>>().toExtend<Wire<RoundSummary>>();
    expectTypeOf<Wire<SettingsView>>().toExtend<z.infer<typeof settingsViewSchema>>();
    expectTypeOf<z.infer<typeof settingsViewSchema>>().toExtend<Wire<SettingsView>>();
  });

  it("HomeView, RecordsView, SettingsPageView and History", () => {
    expectTypeOf<Wire<HomeView>>().toExtend<z.infer<typeof homeViewSchema>>();
    expectTypeOf<z.infer<typeof homeViewSchema>>().toExtend<Wire<HomeView>>();
    expectTypeOf<Wire<RecordsView>>().toExtend<z.infer<typeof recordsViewSchema>>();
    expectTypeOf<z.infer<typeof recordsViewSchema>>().toExtend<Wire<RecordsView>>();
    expectTypeOf<Wire<SettingsPageView>>().toExtend<
      z.infer<typeof settingsPageViewSchema>
    >();
    expectTypeOf<z.infer<typeof settingsPageViewSchema>>().toExtend<
      Wire<SettingsPageView>
    >();
    expectTypeOf<Wire<History>>().toExtend<z.infer<typeof historySchema>>();
    expectTypeOf<z.infer<typeof historySchema>>().toExtend<Wire<History>>();
  });

  it("does not pass by construction: a view missing a field fails the check", () => {
    type Short = Omit<Wire<History>, "estimatedLevel">;
    expectTypeOf<Short>().not.toExtend<z.infer<typeof historySchema>>();
    expectTypeOf<z.infer<typeof historySchema>>().toExtend<Short>();
  });
});

describe("each request schema carries exactly what its command takes", () => {
  it("a start carries the command whole", () => {
    expectTypeOf<z.infer<typeof startRoundRequestSchema>>().toExtend<StartCommand>();
    expectTypeOf<StartCommand>().toExtend<z.infer<typeof startRoundRequestSchema>>();
  });

  it("an answer carries everything but the round, which the path names", () => {
    type Placed = z.infer<typeof answerSchema> & { roundId: string };
    expectTypeOf<Placed>().toExtend<AnswerInput>();
    expectTypeOf<Wire<AnswerInput>>().toExtend<Placed>();
  });

  it("a settings patch is the domain's patch, absent fields left out", () => {
    expectTypeOf<z.infer<typeof settingsPatchSchema>>().toExtend<SettingsPatch>();
    expectTypeOf<Wire<SettingsPatch>>().toExtend<z.infer<typeof settingsPatchSchema>>();
  });

  it("gives every code the application reports a status", () => {
    expectTypeOf<ApplicationErrorCode>().toExtend<ErrorCode>();
  });
});

describe("request bounds", () => {
  const answer = {
    id: "a1",
    cardId: "work-a-1-0",
    pass: "first",
    result: "ok",
    elapsedMs: 3_000,
  } as const;

  it("holds a batch to two passes over the largest deck", () => {
    expect(MAX_ROUND_ANSWERS).toBe(Math.max(...TUNING.dailySizes) * 2);
    const batch = (size: number) =>
      answersRequestSchema.safeParse({
        answers: Array.from({ length: size }, (_, index) => ({
          ...answer,
          id: `a${String(index)}`,
        })),
      }).success;
    expect(batch(0)).toBe(true);
    expect(batch(60)).toBe(true);
    expect(batch(61)).toBe(false);
  });

  it.each([
    ["an empty id", { ...answer, id: "" }],
    ["an id of 65 characters", { ...answer, id: "x".repeat(65) }],
    ["a negative elapsedMs", { ...answer, elapsedMs: -1 }],
    ["a fractional elapsedMs", { ...answer, elapsedMs: 1.5 }],
    ["an elapsedMs over ten minutes", { ...answer, elapsedMs: 600_001 }],
    ["an unknown pass", { ...answer, pass: "third" }],
    ["an unknown result", { ...answer, result: "skip" }],
  ])("refuses an answer with %s", (_, value) => {
    expect(answerSchema.safeParse(value).success).toBe(false);
  });

  it("takes an id of 64 characters and ten minutes exactly", () => {
    expect(
      answerSchema.safeParse({ ...answer, id: "x".repeat(64), elapsedMs: 600_000 })
        .success,
    ).toBe(true);
  });

  it.each([["" as const], ["x".repeat(65)]])("refuses the roundId %j", (roundId) => {
    expect(roundIdParamSchema.safeParse(roundId).success).toBe(false);
    expect(startRoundRequestSchema.safeParse({ roundId, kind: "today" }).success).toBe(
      false,
    );
  });

  it("refuses a start of a kind the app does not ship", () => {
    expect(
      startRoundRequestSchema.safeParse({ roundId: "r1", kind: "weekly" }).success,
    ).toBe(false);
  });

  it.each([
    ["a daily size not on offer", { dailySize: 7 }],
    ["an empty topic id", { topics: [""] }],
    ["51 topics", { topics: Array.from({ length: 51 }, (_, i) => `t${String(i)}`) }],
    ["a focus without a subtopic", { focus: [{ topic: "work" }] }],
    ["an explicit undefined", { sound: undefined }],
  ])("refuses a settings patch with %s", (_, patch) => {
    expect(settingsPatchSchema.safeParse(patch).success).toBe(false);
  });

  it("takes an empty patch and drops a field it does not name", () => {
    expect(settingsPatchSchema.parse({ sound: false, theme: "light" })).toStrictEqual({
      sound: false,
    });
    expect(settingsPatchSchema.parse({})).toStrictEqual({});
  });
});

/** Fails the test with the application's code when a command or query refused. */
async function value<T>(
  result: Promise<{ ok: true; value: T } | { ok: false; error: { code: string } }>,
): Promise<T> {
  const settled = await result;
  if (!settled.ok) {
    throw new Error(settled.error.code);
  }
  return settled.value;
}

/** The value as a client reads it off the wire. */
function wire(view: unknown): unknown {
  return JSON.parse(JSON.stringify(view));
}

describe("what the application answers parses under the contract", () => {
  async function throughTheDay(h: Harness) {
    const views: [string, z.ZodType, unknown][] = [];
    const note = (name: string, schema: z.ZodType, view: unknown) => {
      views.push([name, schema, view]);
    };
    note(
      "home before settings",
      homeViewSchema,
      await value(home(h.deps, h.context())),
    );
    note(
      "updateSettings",
      settingsViewSchema,
      await value(
        updateSettings(h.deps, h.context(), {
          topics: ["work", "travel"],
          dailySize: 10,
        }),
      ),
    );
    note(
      "settingsPage",
      settingsPageViewSchema,
      await value(settingsPage(h.deps, h.context())),
    );
    const placement = await value(
      startRound(h.deps, h.context(), { kind: "placement", roundId: "p0" }),
    );
    note("startRound placement", roundPayloadSchema, placement);
    note(
      "finishRound placement",
      roundSummarySchema,
      await value(
        finishRound(h.deps, h.context(), {
          roundId: placement.id,
          answers: answersFor(placement),
        }),
      ),
    );
    const later = NOON + DAY_MS;
    const today = await value(
      startRound(h.deps, h.context(later), { kind: "today", roundId: "t1" }),
    );
    const answers = answersFor(today, (_, index) => (index % 2 === 0 ? "ok" : "ng"));
    await value(
      recordAnswers(h.deps, h.context(later), {
        roundId: today.id,
        answers: answers.slice(0, 3),
      }),
    );
    note(
      "home in progress",
      homeViewSchema,
      await value(home(h.deps, h.context(later))),
    );
    note(
      "startRound resumed",
      roundPayloadSchema,
      await value(
        startRound(h.deps, h.context(later), { kind: "today", roundId: "t2" }),
      ),
    );
    note(
      "finishRound today",
      roundSummarySchema,
      await value(
        finishRound(h.deps, h.context(later), { roundId: today.id, answers }),
      ),
    );
    note(
      "roundSummary",
      roundSummarySchema,
      await value(roundSummary(h.deps, h.context(later), today.id)),
    );
    note("home done", homeViewSchema, await value(home(h.deps, h.context(later))));
    note("records", recordsViewSchema, await value(records(h.deps, h.context(later))));
    note("history", historySchema, await value(history(h.deps, h.context(later))));
    return views;
  }

  it("for every view a day of practice produces", async () => {
    const views = await throughTheDay(makeHarness());
    expect(views.map(([name]) => name)).toHaveLength(12);
    for (const [name, schema, view] of views) {
      const parsed = schema.safeParse(wire(view));
      expect({ name, issues: parsed.error?.issues ?? [] }).toStrictEqual({
        name,
        issues: [],
      });
    }
  });

  it("including a home with no preview and no finished round, which leaves both fields out", async () => {
    const h = makeHarness();
    const view = await value(home(h.deps, h.context()));
    const read = wire(view);
    expect(read).not.toHaveProperty("preview");
    expect(read).not.toHaveProperty("todayLastRoundId");
    expect(homeViewSchema.safeParse(read).success).toBe(true);
  });
});
