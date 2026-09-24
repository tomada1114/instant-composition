import type { RoundSummary } from "@instant-composition/web";

const DAYS = Array.from(
  { length: 14 },
  (_, index) => `2026-09-${String(10 + index).padStart(2, "0")}`,
);

/** A today's-portion summary with growth, review, a streak step and reach added. */
export function makeSummary(overrides: Partial<RoundSummary> = {}): RoundSummary {
  return {
    roundId: "r1",
    kind: "today",
    day: "2026-09-23",
    yesterday: false,
    placement: null,
    growth: {
      faster: 3,
      fixed: 2,
      compared: 6,
      firstTime: 4,
      rows: [
        {
          cardId: "c1",
          prompt: "会議を来週に延ばせますか",
          kind: "faster",
          deltaMs: 1200,
        },
        {
          cardId: "c2",
          prompt: "見積もりを明日まで待ってください",
          kind: "fixed",
          deltaMs: 900,
        },
        {
          cardId: "c3",
          prompt: "駅までの道を教えてください",
          kind: "faster",
          deltaMs: 600,
        },
        { cardId: "c4", prompt: "資料を先に送ります", kind: "faster", deltaMs: 500 },
        {
          cardId: "c5",
          prompt: "打ち合わせは三時からです",
          kind: "fixed",
          deltaMs: 100,
        },
      ],
    },
    review: [
      { cardId: "r1", prompt: "請求書は今日中に送ります" },
      { cardId: "r2", prompt: "在庫を確認してから連絡します" },
      { cardId: "r3", prompt: "会議室を予約しておきます" },
      { cardId: "r4", prompt: "取引先に折り返し電話します" },
    ],
    streak: { value: 13, restart: false, changed: true },
    week: [
      { day: "2026-09-21", state: "done" },
      { day: "2026-09-22", state: "done" },
      { day: "2026-09-23", state: "done" },
      { day: "2026-09-24", state: "upcoming" },
      { day: "2026-09-25", state: "upcoming" },
      { day: "2026-09-26", state: "upcoming" },
      { day: "2026-09-27", state: "upcoming" },
    ],
    filled: "2026-09-23",
    difficulty: null,
    reach: {
      topics: [
        {
          id: "daily",
          name: "日常",
          count: 101,
          added: 3,
          ring: { from: 100, to: 200, done: 1, span: 100 },
        },
        {
          id: "work",
          name: "仕事",
          count: 137,
          added: 2,
          ring: { from: 100, to: 200, done: 37, span: 100 },
        },
        {
          id: "it",
          name: "IT・技術",
          count: 58,
          added: 0,
          ring: { from: 50, to: 100, done: 8, span: 50 },
        },
      ],
      nearest: { name: "IT・技術", remaining: 42 },
    },
    titles: [],
    topicNames: { daily: "日常", work: "仕事", it: "IT・技術", travel: "旅行" },
    points: { earned: 20, total: 3105 },
    totals: {
      said: 2315,
      practicedDays: 79,
      last14: DAYS.map((day, index) => ({ day, count: index * 2 })),
      added: 12,
    },
    portionCompleted: true,
    todayOpen: false,
    continueToday: false,
    ...overrides,
  };
}
