import * as z from "zod";

import {
  countSchema,
  dotSchema,
  levelSchema,
  reachViewSchema,
  roundKindSchema,
  settingsSchema,
} from "./primitives";

/**
 * What a query answers with: `packages/application`'s `query-views.ts`,
 * written as schemas. `tests/contracts-schemas.test.ts` holds each to the type
 * it mirrors.
 */

/** The number above the week: a run to show, or "day 1 from today" instead of a 0. */
export const streakViewSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("count"), value: countSchema, yesterdayGap: z.boolean() }),
  z.object({ kind: z.literal("restart"), longest: countSchema }),
]);

export const homeStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("onboarding") }),
  z.object({ kind: z.literal("placement") }),
  z.object({ kind: z.literal("ready"), streak: streakViewSchema }),
  z.object({ kind: z.literal("recover-offer"), streak: streakViewSchema }),
  z.object({
    kind: z.literal("in-progress"),
    portion: z.enum(["today", "yesterday"]),
    progress: countSchema,
    target: countSchema,
    resumeKind: roundKindSchema,
    streak: streakViewSchema,
  }),
  z.object({
    kind: z.literal("done"),
    restoresTo: countSchema.nullable(),
    streak: streakViewSchema,
  }),
  z.object({
    kind: z.literal("not-enough"),
    available: countSchema,
    streak: streakViewSchema,
  }),
]);

export const homePreviewSchema = z.object({
  size: countSchema,
  setting: countSchema,
  shortage: z.boolean(),
  reviewCount: countSchema,
  newCount: countSchema,
  focusNames: z.array(z.string()),
  minutes: countSchema,
});

export const homeViewSchema = z.object({
  state: homeStateSchema,
  week: z.array(dotSchema),
  /** Absent when no round can be dealt today. */
  preview: homePreviewSchema.exactOptional(),
  todayRounds: countSchema,
  todayCards: countSchema,
  /** Today's last finished round, for the recap to read back; absent before any. */
  todayLastRoundId: z.string().exactOptional(),
  dailySize: countSchema,
  sound: z.boolean(),
  contentError: z.boolean(),
});

export const breakdownTopicSchema = z.object({
  id: z.string(),
  name: z.string(),
  subtopics: z.array(
    z.object({ id: z.string(), name: z.string(), count: countSchema }),
  ),
});

/** The milestones taken in one row of the records screen: the streak, or one topic. */
export const titleGroupSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("streak"), values: z.array(countSchema) }),
  z.object({
    kind: z.literal("reach"),
    topic: z.string(),
    name: z.string(),
    values: z.array(countSchema),
  }),
]);

export const recordsViewSchema = z.object({
  reach: reachViewSchema,
  breakdown: z.array(breakdownTopicSchema),
  toeic: z.string().nullable(),
  streak: z.object({ current: countSchema, longest: countSchema }),
  /** Twelve weeks, oldest first, Monday to Sunday in each. */
  calendar: z.array(z.array(dotSchema)),
  said: countSchema,
  practicedDays: countSchema,
  points: countSchema,
  titles: z.array(titleGroupSchema),
});

export const topicInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  subtopics: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const settingsPageViewSchema = z.object({
  settings: settingsSchema,
  topics: z.array(topicInfoSchema),
  toeic: z.string().nullable(),
});

/** What the card-planning tooling reads. */
export const historySchema = z.object({
  seenIds: z.array(z.string()),
  topics: z.array(z.string()),
  focusSubtopics: z.array(z.string()),
  estimatedLevel: levelSchema,
});
