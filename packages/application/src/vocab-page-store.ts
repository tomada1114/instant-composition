import type {
  VocabPagedSession,
  VocabSessionGuard,
  VocabDeckPage,
  VocabPageProgress,
} from "@instant-composition/domain";
import type { Stored } from "./store";
export type VocabPagedEntry =
  | { readonly type: "vocabSessionGuard"; readonly value: VocabSessionGuard }
  | { readonly type: "vocabPagedSession"; readonly value: VocabPagedSession }
  | { readonly type: "vocabDeckPage"; readonly value: VocabDeckPage }
  | { readonly type: "vocabPageProgress"; readonly value: VocabPageProgress };
export type VocabPagedKey =
  | { readonly type: "vocabSessionGuard"; readonly id: string }
  | { readonly type: "vocabPagedSession"; readonly id: string }
  | {
      readonly type: "vocabDeckPage" | "vocabPageProgress";
      readonly sessionId: string;
      readonly generation: number;
      readonly page: number;
    };
export function vocabPagedKeyOf(entry: VocabPagedEntry): VocabPagedKey {
  switch (entry.type) {
    case "vocabSessionGuard":
    case "vocabPagedSession":
      return { type: entry.type, id: entry.value.id };
    case "vocabDeckPage":
    case "vocabPageProgress":
      return {
        type: entry.type,
        sessionId: entry.value.sessionId,
        generation: entry.value.generation,
        page: entry.value.page,
      };
  }
}
/** Bounded learner-bound point reads; immutable membership and mutable progress remain separate. */
export interface VocabPagedStore {
  vocabSessionGuard(id: string): Promise<Stored<VocabSessionGuard> | undefined>;
  vocabPagedSession(id: string): Promise<Stored<VocabPagedSession> | undefined>;
  vocabDeckPage(
    sessionId: string,
    generation: number,
    page: number,
  ): Promise<Stored<VocabDeckPage> | undefined>;
  vocabPageProgress(
    sessionId: string,
    generation: number,
    page: number,
  ): Promise<Stored<VocabPageProgress> | undefined>;
}
