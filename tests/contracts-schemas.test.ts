import {
  finishRound,
  history,
  home,
  profile,
  recordAnswers,
  roundPayload,
  roundSummary,
  records,
  settingsPage,
  startRound,
  updateLevel,
  updateProfile,
  updateSettings,
  type ApplicationErrorCode,
  type History,
  type HomeView,
  type LevelView,
  type Profile,
  type ProfilePatch,
  type RecordsView,
  type RoundPayload,
  type RoundSummary,
  type SettingsPageView,
  type SettingsView,
} from "@instant-composition/application";
import {
  answerSchema,
  answersRequestSchema,
  gradeKeySchema,
  historySchema,
  homeViewSchema,
  type levelChoiceSchema,
  levelViewSchema,
  MAX_ANSWER_TEXT,
  MAX_ROUND_ANSWERS,
  profilePatchSchema,
  profileSchema,
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
  isGradeKey,
  TUNING,
  type AnswerInput,
  type LevelChoice,
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
  it("LevelView", () => {
    expectTypeOf<Wire<LevelView>>().toExtend<z.infer<typeof levelViewSchema>>();
    expectTypeOf<z.infer<typeof levelViewSchema>>().toExtend<Wire<LevelView>>();
  });

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

  it("Profile", () => {
    expectTypeOf<Wire<Profile>>().toExtend<z.infer<typeof profileSchema>>();
    expectTypeOf<z.infer<typeof profileSchema>>().toExtend<Wire<Profile>>();
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

  it("a level choice is the domain's choice", () => {
    expectTypeOf<z.infer<typeof levelChoiceSchema>>().toExtend<LevelChoice>();
    expectTypeOf<LevelChoice>().toExtend<z.infer<typeof levelChoiceSchema>>();
  });

  it("a settings patch is the domain's patch, absent fields left out", () => {
    expectTypeOf<z.infer<typeof settingsPatchSchema>>().toExtend<SettingsPatch>();
    expectTypeOf<Wire<SettingsPatch>>().toExtend<z.infer<typeof settingsPatchSchema>>();
  });

  it("a profile patch fits the command's patch, its UI locale narrowed to the catalogs", () => {
    expectTypeOf<z.infer<typeof profilePatchSchema>>().toExtend<ProfilePatch>();
    expectTypeOf<Wire<Omit<ProfilePatch, "uiLocale">>>().toExtend<
      z.infer<typeof profilePatchSchema>
    >();
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
    ["an unknown pass", { ...answer, pass: "third" }],
    ["an unknown result", { ...answer, result: "skip" }],
    ["a negative answeredAt", { ...answer, answeredAt: -1 }],
    ["a fractional answeredAt", { ...answer, answeredAt: 1.5 }],
    ["an answeredAt that is not a number", { ...answer, answeredAt: "2026-09-22" }],
    ["a text of 301 characters", { ...answer, text: "x".repeat(301) }],
    ["a text that is not a string", { ...answer, text: 42 }],
    ["a text given as an explicit undefined", { ...answer, text: undefined }],
  ])("refuses an answer with %s", (_, value) => {
    expect(answerSchema.safeParse(value).success).toBe(false);
  });

  it("takes an answer with or without the epoch milliseconds it was given at", () => {
    expect(answerSchema.safeParse(answer).success).toBe(true);
    expect(
      answerSchema.safeParse({ ...answer, answeredAt: 1_790_000_000_000 }).data,
    ).toStrictEqual({
      ...answer,
      answeredAt: 1_790_000_000_000,
    });
  });

  it("takes an id of 64 characters and ten minutes exactly", () => {
    expect(
      answerSchema.safeParse({ ...answer, id: "x".repeat(64), elapsedMs: 600_000 })
        .success,
    ).toBe(true);
  });

  it.each([[600_001], [3_600_000]])(
    "takes an elapsedMs of %i, over the cap, for the server to clamp rather than refuse",
    (elapsedMs) => {
      expect(answerSchema.parse({ ...answer, elapsedMs })).toStrictEqual({
        ...answer,
        elapsedMs,
      });
    },
  );

  it("holds a typed answer's text to 300 characters, an empty one included", () => {
    expect(MAX_ANSWER_TEXT).toBe(300);
    for (const text of ["", "Let's get started.", "x".repeat(300)]) {
      expect(answerSchema.parse({ ...answer, text })).toStrictEqual({
        ...answer,
        text,
      });
    }
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

  it("takes exactly the time limits the domain offers", () => {
    for (const limitSeconds of TUNING.limitSeconds) {
      expect(settingsPatchSchema.safeParse({ limitSeconds }).success).toBe(true);
    }
    expect(settingsPatchSchema.safeParse({ limitSeconds: 25 }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ limitSeconds: 30_000 }).success).toBe(false);
  });

  it.each([["spoken" as const], ["typed" as const]])(
    "takes the answer mode %s",
    (answerMode) => {
      expect(settingsPatchSchema.parse({ answerMode })).toStrictEqual({ answerMode });
    },
  );

  it("takes a grade key pair of an arrow, a digit or a letter each", () => {
    for (const gradeKeys of [
      { ok: "ArrowRight", ng: "ArrowLeft" },
      { ok: "ArrowUp", ng: "ArrowDown" },
      { ok: "KeyK", ng: "KeyJ" },
      { ok: "Digit1", ng: "Digit0" },
    ]) {
      expect(settingsPatchSchema.parse({ gradeKeys })).toStrictEqual({ gradeKeys });
    }
  });

  it("holds the grade keys to the set the domain allows", () => {
    const codes = [
      ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => `Key${letter}`),
      ..."0123456789".split("").map((digit) => `Digit${digit}`),
      ...["Up", "Down", "Left", "Right"].map((way) => `Arrow${way}`),
      ...["Space", "Enter", "Escape", "Slash", "Tab", "Numpad1", "F1", "ShiftLeft"],
      ...["Keya", "KeyAB", "Digit10", "ArrowUpLeft", "k", "→", " KeyA", ""],
    ];
    expect(
      codes.map((code) => [code, gradeKeySchema.safeParse(code).success]),
    ).toStrictEqual(codes.map((code) => [code, isGradeKey(code)]));
    expect(codes.filter((code) => isGradeKey(code))).toHaveLength(40);
  });

  it.each([
    ["a daily size not on offer", { dailySize: 7 }],
    ["an empty topic id", { topics: [""] }],
    ["51 topics", { topics: Array.from({ length: 51 }, (_, i) => `t${String(i)}`) }],
    ["a focus without a subtopic", { focus: [{ topic: "work" }] }],
    ["an explicit undefined", { sound: undefined }],
    ["both grades on one key", { gradeKeys: { ok: "KeyJ", ng: "KeyJ" } }],
    ["a grade on Space", { gradeKeys: { ok: "Space", ng: "KeyJ" } }],
    ["a grade on the key `?` is on", { gradeKeys: { ok: "KeyK", ng: "Slash" } }],
    ["a grade given as a character", { gradeKeys: { ok: "k", ng: "j" } }],
    ["one grade key alone", { gradeKeys: { ok: "KeyK" } }],
    ["an answer mode the app does not ship", { answerMode: "voice" }],
  ])("refuses a settings patch with %s", (_, patch) => {
    expect(settingsPatchSchema.safeParse(patch).success).toBe(false);
  });

  it.each([
    ["an empty time zone", { timeZone: "" }],
    ["a time zone of 65 characters", { timeZone: "x".repeat(65) }],
    ["an empty first language", { l1: "" }],
    ["a target of 36 characters", { target: "x".repeat(36) }],
    ["a UI locale with no catalog", { uiLocale: "en" }],
    ["an explicit undefined", { timeZone: undefined }],
  ])("refuses a profile patch with %s", (_, patch) => {
    expect(profilePatchSchema.safeParse(patch).success).toBe(false);
  });

  it("takes a partial profile patch and drops a field it does not name", () => {
    expect(
      profilePatchSchema.parse({
        timeZone: "Europe/London",
        learnerId: "someone-else",
      }),
    ).toStrictEqual({ timeZone: "Europe/London" });
    expect(profilePatchSchema.parse({ uiLocale: "ja" })).toStrictEqual({
      uiLocale: "ja",
    });
    expect(profilePatchSchema.parse({})).toStrictEqual({});
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
    note("profile", profileSchema, await value(profile(h.deps, h.context())));
    note(
      "updateProfile",
      profileSchema,
      await value(updateProfile(h.deps, h.context(), { timeZone: "Asia/Tokyo" })),
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
    note(
      "updateLevel",
      levelViewSchema,
      await value(updateLevel(h.deps, h.context(), { mode: "manual", level: 3 })),
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
      "roundPayload with answers",
      roundPayloadSchema,
      await value(roundPayload(h.deps, h.context(later), today.id)),
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
    expect(views.map(([name]) => name)).toHaveLength(16);
    for (const [name, schema, view] of views) {
      const parsed = schema.safeParse(wire(view));
      expect({ name, issues: parsed.error?.issues ?? [] }).toStrictEqual({
        name,
        issues: [],
      });
    }
  });

  it("including a typed round's, which carry its mode and each text typed", async () => {
    const h = makeHarness();
    const settings = await value(
      updateSettings(h.deps, h.context(), { topics: ["work"], answerMode: "typed" }),
    );
    const round = await value(
      startRound(h.deps, h.context(), { kind: "placement", roundId: "p0" }),
    );
    const answers = answersFor(round).map((answer, index) =>
      index === 0 ? { ...answer, text: "Let's get started." } : answer,
    );
    await value(
      recordAnswers(h.deps, h.context(), {
        roundId: round.id,
        answers: answers.slice(0, 1),
      }),
    );
    const read = await value(roundPayload(h.deps, h.context(), round.id));
    const summary = await value(
      finishRound(h.deps, h.context(), { roundId: round.id, answers }),
    );

    expect(settingsViewSchema.parse(wire(settings)).settings.answerMode).toBe("typed");
    expect(roundPayloadSchema.parse(wire(round)).answerMode).toBe("typed");
    expect(roundPayloadSchema.parse(wire(read)).answered[0]?.text).toBe(
      "Let's get started.",
    );
    const kept = roundSummarySchema.parse(wire(summary));
    expect(kept.answerMode).toBe("typed");
    expect(
      kept.answered.filter((row) => row.text !== undefined).map((row) => row.id),
    ).toStrictEqual([answers[0]?.id]);
    expect(kept.answered).toHaveLength(answers.length);
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
