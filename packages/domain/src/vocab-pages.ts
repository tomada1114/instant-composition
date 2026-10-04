import type {
  VocabAnswer,
  VocabCategory,
  VocabSessionKind,
  VocabSnapshot,
} from "./vocab";

/** Fixed storage and transport budgets, independent of a learner's daily quota. */
export const VOCAB_PAGE_SIZE = 64;
export const VOCAB_AGAIN_PREVIEW = 32;

/** A small logical-session checkpoint; immutable deck ids live only in pages. */
export interface VocabPagedSession {
  readonly id: string;
  readonly kind: VocabSessionKind;
  readonly category: VocabCategory | null;
  readonly day: string;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly tomorrow: number | null;
  readonly status: "building" | "ready";
  readonly generation: number;
  readonly catalog: string;
  readonly sourceVersion: number;
  readonly modelVersion: number;
  readonly settingsVersion: number | null;
  readonly statsVersion: number | null;
  readonly candidateGeneration: string;
  readonly dueCount: number;
  /** At most the finite new quota, or a finite extra/weak session. */
  readonly fresh: readonly string[];
  readonly dueCursor: string | null;
  readonly dueRead: number;
  readonly freshRead: number;
  readonly pages: number;
  readonly total: number;
  readonly answered: number;
  readonly introduced: number;
  readonly againCount: number;
  readonly again: readonly (VocabSnapshot & { readonly cardId: string })[];
}

/** One immutable page of the selected deck. Abandoned generations remain readable. */
export interface VocabDeckPage {
  readonly sessionId: string;
  readonly generation: number;
  readonly page: number;
  readonly cards: readonly { readonly id: string; readonly isNew: boolean }[];
}

/** Adoption of first answers, separate from the immutable deck and bounded by its page. */
export interface VocabPageProgress {
  readonly sessionId: string;
  readonly generation: number;
  readonly page: number;
  readonly answered: readonly string[];
}

/** The immutable page proves membership even when an answer is retried much later. */
export interface VocabPagedAnswer extends VocabAnswer {
  readonly page: number;
}

/** Which global queue positions contain new cards, without materializing the queue. */
export function vocabFreshPosition(index: number, due: number, fresh: number): number {
  if (
    ![index, due, fresh].every(Number.isSafeInteger) ||
    index < 0 ||
    due < 0 ||
    fresh < 1 ||
    fresh > 200 ||
    index >= fresh
  )
    throw new RangeError("A fresh position requires bounded safe counters.");
  const step = index + 1;
  // k * due may be unsafe although the final interleaved position is exact.
  const position =
    Math.floor(due / fresh) * step + Math.floor(((due % fresh) * step) / fresh) + index;
  if (!Number.isSafeInteger(position))
    throw new RangeError("A fresh position exceeds the supported safe range.");
  return position;
}

/** Small end guard for sessions created by legacy clients. */
export interface VocabSessionGuard {
  readonly id: string;
  readonly finishedAt: number | null;
}
