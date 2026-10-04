import {
  vocabPagedKeyOf,
  type VocabPagedEntry,
  type VocabPagedKey,
} from "./vocab-page-store";
import type {
  DayKey,
  DayTally,
  ItemProgress,
  ItemRef,
  LearnerStats,
  ModelTask,
  ModelTaskKey,
  PersonalCard,
  Portion,
  ReviewEntry,
  Round,
  Settings,
  StreakRun,
  Talk,
  VocabProgress,
  VocabReview,
  VocabSession,
} from "@instant-composition/domain";
import type {
  CompositionBuild,
  CompositionReadModel,
  CompositionSource,
  StreakMigration,
} from "./composition-model";
import type {
  ReadModelSource,
  VocabCandidate,
  VocabReadModel,
  VocabReadModelRequest,
} from "./read-model";
import type { Profile } from "./context";
import type { CompositionCandidate } from "./composition-candidate";

/** One record of a learner's data. Its key is derived from its value (`keyOf`). */
export type Entry =
  | VocabPagedEntry
  | { readonly type: "modelTask"; readonly value: ModelTask }
  | { readonly type: "compositionCandidate"; readonly value: CompositionCandidate }
  | { readonly type: "compositionSource"; readonly value: CompositionSource }
  | { readonly type: "compositionReadModel"; readonly value: CompositionReadModel }
  | { readonly type: "compositionBuild"; readonly value: CompositionBuild }
  | { readonly type: "streakRun"; readonly value: StreakRun }
  | { readonly type: "streakMigration"; readonly value: StreakMigration }
  | { readonly type: "profile"; readonly value: Profile }
  | { readonly type: "settings"; readonly value: Settings }
  | { readonly type: "stats"; readonly value: LearnerStats }
  | { readonly type: "round"; readonly value: Round }
  | { readonly type: "review"; readonly value: ReviewEntry }
  | { readonly type: "portion"; readonly value: Portion }
  | { readonly type: "day"; readonly value: DayTally }
  | { readonly type: "item"; readonly value: ItemProgress }
  | { readonly type: "talk"; readonly value: Talk }
  | { readonly type: "vocabItem"; readonly value: VocabProgress }
  | { readonly type: "vocabSession"; readonly value: VocabSession }
  | { readonly type: "vocabReview"; readonly value: VocabReview }
  | { readonly type: "card"; readonly value: PersonalCard }
  | { readonly type: "readModelSource"; readonly value: ReadModelSource }
  | { readonly type: "vocabReadModel"; readonly value: VocabReadModel }
  | { readonly type: "vocabReadModelRequest"; readonly value: VocabReadModelRequest }
  | { readonly type: "vocabCandidate"; readonly value: VocabCandidate };

/** Where an entry lives inside the learner's own data; no key names a learner. */
export type Key =
  | VocabPagedKey
  | { readonly type: "modelTask"; readonly task: ModelTaskKey }
  | { readonly type: "compositionCandidate"; readonly candidate: CompositionCandidate }
  | { readonly type: "compositionSource" }
  | { readonly type: "compositionReadModel"; readonly day: DayKey }
  | { readonly type: "compositionBuild"; readonly day: DayKey }
  | { readonly type: "streakRun"; readonly start: DayKey }
  | { readonly type: "streakMigration" }
  | { readonly type: "profile" }
  | { readonly type: "settings" }
  | { readonly type: "stats" }
  | { readonly type: "round"; readonly id: string }
  | { readonly type: "review"; readonly sessionId: string; readonly id: string }
  | { readonly type: "portion"; readonly day: DayKey }
  | { readonly type: "day"; readonly day: DayKey }
  | { readonly type: "item"; readonly item: ItemRef }
  | { readonly type: "talk"; readonly id: string }
  | { readonly type: "vocabItem"; readonly cardId: string }
  | { readonly type: "vocabSession"; readonly id: string }
  | { readonly type: "vocabReview"; readonly sessionId: string; readonly id: string }
  | { readonly type: "card"; readonly id: string }
  | { readonly type: "readModelSource" }
  | { readonly type: "vocabReadModel"; readonly day: DayKey }
  | { readonly type: "vocabReadModelRequest"; readonly day: DayKey }
  | { readonly type: "vocabCandidate"; readonly candidate: VocabCandidate };

export function keyOf(entry: Entry): Key {
  switch (entry.type) {
    case "vocabPagedSession":
    case "vocabDeckPage":
    case "vocabPageProgress":
    case "vocabSessionGuard":
      return vocabPagedKeyOf(entry);
    case "modelTask":
      return { type: entry.type, task: entry.value.key };
    case "compositionCandidate":
      return { type: entry.type, candidate: entry.value };
    case "profile":
    case "settings":
    case "stats":
    case "readModelSource":
    case "compositionSource":
    case "streakMigration":
      return { type: entry.type };
    case "compositionReadModel":
    case "compositionBuild":
      return { type: entry.type, day: entry.value.day };
    case "streakRun":
      return { type: entry.type, start: entry.value.start };
    case "round":
      return { type: "round", id: entry.value.id };
    case "review":
      return { type: "review", sessionId: entry.value.sessionId, id: entry.value.id };
    case "portion":
    case "day":
      return { type: entry.type, day: entry.value.day };
    case "item":
      return { type: "item", item: entry.value.item };
    case "talk":
    case "vocabSession":
    case "card":
      return { type: entry.type, id: entry.value.id };
    case "vocabItem":
      return { type: "vocabItem", cardId: entry.value.cardId };
    case "vocabReadModel":
    case "vocabReadModelRequest":
      return { type: entry.type, day: entry.value.day };
    case "vocabCandidate":
      return { type: entry.type, candidate: entry.value };
    case "vocabReview":
      return {
        type: "vocabReview",
        sessionId: entry.value.sessionId,
        id: entry.value.id,
      };
  }
}
