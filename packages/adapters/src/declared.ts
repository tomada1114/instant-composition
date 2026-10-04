import { compactStats } from "@instant-composition/domain";
import type { FirstPassMark } from "@instant-composition/domain";
import { declaredModelTask } from "./declared-model-task";
import type { Entry } from "@instant-composition/application";
import { declaredReadModel } from "./read-model-schema";
import { declaredCompositionCandidate } from "./composition-candidate-schema";
import {
  SETTINGS,
  ROUND,
  DETAIL,
  ITEM,
  MARK,
  TALK,
  TURN,
  VOCAB_ITEM,
  VOCAB_SESSION,
  VOCAB_REVIEW,
  CARD,
  type Fields,
} from "./declared-fields";

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
    case "modelTask":
      return declaredModelTask(entry.value);
    case "compositionCandidate":
      return declaredCompositionCandidate(entry.value);
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
    case "vocabItem":
      return declared(entry.value, VOCAB_ITEM);
    case "vocabSession":
      return declared(entry.value, VOCAB_SESSION);
    case "vocabReview":
      return declared(entry.value, VOCAB_REVIEW);
    case "card":
      return declared(entry.value, CARD);
    case "vocabReadModelRequest":
    case "readModelSource":
    case "vocabReadModel":
    case "vocabCandidate":
      return declaredReadModel(entry);
    case "stats":
      return entry.value.streak === undefined
        ? entry.value
        : compactStats(entry.value, entry.value.streak.longest);
    case "compositionSource":
    case "compositionReadModel":
    case "compositionBuild":
    case "streakRun":
    case "streakMigration":
      return entry.value;
    case "profile":
    case "portion":
    case "day":
      return entry.value;
  }
}
