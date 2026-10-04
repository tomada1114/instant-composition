import type { DayKey, PersonalCard } from "@instant-composition/domain";

import type { Stored } from "./store";
import type { VocabCategory } from "./vocab-item";

/** Fixed bounds for each maintenance step and candidate page. */
export const READ_MODEL_PAGE_SIZE = 10;
export const CANDIDATE_PAGE_SIZE = 250;

export interface VocabCounts {
  readonly category: VocabCategory;
  readonly total: number;
  readonly learning: number;
  readonly due: number;
  readonly fresh: number;
  readonly weak: number;
  readonly tomorrow: number;
  readonly introduced: number;
  readonly reviewed: number;
}

/** One bounded checkpoint. Candidate ids live in separate primary-key rows. */
export interface VocabReadModel {
  readonly expiresAt?: number;
  readonly schema: 1;
  readonly day: DayKey;
  readonly catalog: string;
  readonly generation: string;
  readonly sourceVersion: number;
  readonly status: "building" | "ready";
  readonly phase: "catalog" | "personal";
  readonly offset: number;
  readonly cursor: string | null;
  readonly counts: readonly VocabCounts[];
}

export type CandidateMode = "due" | "weak" | "fresh" | "freshLower" | "freshWeak";

export interface VocabCandidate {
  readonly expiresAt?: number;
  readonly schema: 1;
  readonly day: DayKey;
  readonly generation: string;
  readonly mode: CandidateMode;
  readonly category: VocabCategory | null;
  /** Only plain new cards have a level bucket. */
  readonly level: number | null;
  readonly order: string;
  readonly cardId: string;
  readonly cardCategory: VocabCategory;
  readonly cardLevel: number;
  readonly kind: "new" | "review";
}

export interface CandidatePageRequest {
  readonly day: DayKey;
  readonly generation: string;
  readonly mode: CandidateMode;
  readonly category: VocabCategory | null;
  readonly level: number | null;
  readonly limit: number;
  readonly cursor: string | null;
  readonly after?: { readonly order: string; readonly cardId: string };
}

export interface CandidatePage {
  readonly rows: readonly Stored<VocabCandidate>[];
  readonly cursor: string | null;
}

export interface PersonalCardPage {
  readonly rows: readonly Stored<PersonalCard>[];
  readonly cursor: string | null;
}

export interface VocabReadModelRequest {
  readonly schema: 1;
  readonly day: DayKey;
}

export interface VocabReadModelRequestPage {
  readonly rows: readonly Stored<VocabReadModelRequest>[];
  readonly cursor: string | null;
}

export interface ReadModelSource {
  readonly schema: 1;
}

/** A worker's explicit outcome; another source write restarts a generation. */
export interface ReadModelStep {
  readonly status: "building" | "ready" | "restarted";
  readonly day: DayKey;
  readonly rows: number;
}

/** The candidate identity, shared by bounded point reads and mutation planning. */
export function vocabCandidateId(candidate: VocabCandidate): string {
  return JSON.stringify([
    candidate.day,
    candidate.generation,
    candidate.mode,
    candidate.category,
    candidate.level,
    candidate.order,
    candidate.cardId,
  ]);
}

/** Check the runtime generation even when the port exposes the supported literal type. */
export function readModelSchemaSupported(value: { readonly schema: number }): boolean {
  return value.schema === 1;
}
