import type { VocabPagedSession } from "@instant-composition/domain";
import type { VocabSessionView, VocabSummary, VocabCardView } from "./vocab-views";

export interface VocabPreparation {
  readonly sessionId: string;
  readonly status: "building" | "ready";
  readonly generation: number;
  readonly total: number;
}

export interface VocabPagedCardView extends VocabCardView {
  readonly slot: number;
}

export interface VocabPageView extends VocabSessionView {
  readonly cards: readonly VocabPagedCardView[];
  readonly retained: readonly (VocabPagedCardView & { readonly page: number })[];
  readonly generation: number;
  readonly page: number;
  readonly total: number;
  readonly answered: readonly string[];
  readonly continuation: string | null;
}

export interface VocabPagedSummary extends VocabSummary {
  readonly againCount: number;
}

export function preparationOf(session: VocabPagedSession): VocabPreparation {
  return {
    sessionId: session.id,
    status: session.status,
    generation: session.generation,
    total: session.total,
  };
}

export function pagedSummaryOf(session: VocabPagedSession): VocabPagedSummary {
  return {
    sessionId: session.id,
    kind: session.kind,
    category: session.category,
    day: session.day,
    answered: session.answered,
    new: session.introduced,
    again: session.again.map(({ cardId, headword, meaning }) => ({
      cardId,
      headword,
      meaning,
    })),
    againCount: session.againCount,
    tomorrow: session.tomorrow ?? 0,
  };
}
