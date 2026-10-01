import type { Entry } from "@instant-composition/application";
import type {
  CompositionDetail,
  FirstPassMark,
  ItemProgress,
  Round,
  Settings,
  Talk,
  Turn,
} from "@instant-composition/domain";

/**
 * Every field `T` declares, optional ones included. A field added to the type
 * fails to compile at its list below until it is named there, so a read never
 * drops a field the code writes.
 */
type Fields<T> = { readonly [K in keyof T]-?: true };

const SETTINGS = {
  topics: true,
  focus: true,
  dailySize: true,
  sound: true,
  limitSeconds: true,
  gradeKeys: true,
} as const satisfies Fields<Settings>;

const ROUND = {
  id: true,
  kind: true,
  day: true,
  portionDay: true,
  deck: true,
  limitMs: true,
  startedAt: true,
  finishedAt: true,
  abandonedAt: true,
  firstPass: true,
  outcome: true,
} as const satisfies Fields<Round>;

const DETAIL = {
  activity: true,
  pass: true,
  result: true,
  elapsedMs: true,
  limitMs: true,
  paceMs: true,
} as const satisfies Fields<CompositionDetail>;

const ITEM = {
  item: true,
  memory: true,
  okDays: true,
  mastered: true,
  placement: true,
  last: true,
  previous: true,
} as const satisfies Fields<ItemProgress>;

const MARK = {
  sessionId: true,
  result: true,
  elapsedMs: true,
  answeredAt: true,
} as const satisfies Fields<FirstPassMark>;

const TALK = {
  id: true,
  status: true,
  startedAt: true,
  endedAt: true,
  expiresAt: true,
  scene: true,
  opening: true,
  turns: true,
  model: true,
} as const satisfies Fields<Talk>;

const TURN = {
  n: true,
  partnerLine: true,
  japanese: true,
  english: true,
  judgment: true,
  reply: true,
  revealCount: true,
} as const satisfies Fields<Turn>;

function declared<T extends object>(value: T, fields: Fields<T>): T {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => Object.hasOwn(fields, key)),
  ) as T;
}

function markOf(mark: FirstPassMark | null): FirstPassMark | null {
  return mark === null ? null : declared(mark, MARK);
}

/**
 * An entry's value as read: only the fields its type declares. Items keep
 * whatever they were written with and nothing migrates them, so a field the
 * type no longer has, such as the answer mode settings, rounds, answers and
 * items once stored, is dropped here: it is neither returned nor written back.
 */
export function declaredValue(entry: Entry): Entry["value"] {
  switch (entry.type) {
    case "settings":
      return declared(entry.value, SETTINGS);
    case "round":
      return declared(entry.value, ROUND);
    case "review":
      return { ...entry.value, detail: declared(entry.value.detail, DETAIL) };
    case "item":
      return {
        ...declared(entry.value, ITEM),
        last: markOf(entry.value.last),
        previous: markOf(entry.value.previous),
      };
    case "talk":
      return {
        ...declared(entry.value, TALK),
        turns: entry.value.turns.map((turn) => declared(turn, TURN)),
      };
    case "profile":
    case "stats":
    case "portion":
    case "day":
      return entry.value;
  }
}
