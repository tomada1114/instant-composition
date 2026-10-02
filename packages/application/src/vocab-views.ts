import type { DayKey, VocabSession } from "@instant-composition/domain";

import type { VocabCategory } from "./vocab-item";
import type { GradeIntervals } from "./views";

/** One category's row on the hub. */
export interface VocabCategoryView {
  readonly category: VocabCategory;
  /** Its reviews and new cards in today's queue, which a session restricted to it deals. */
  readonly due: number;
  readonly new: number;
  /** Its cards answered at least once, and all its cards the catalog shows. */
  readonly learning: number;
  readonly total: number;
}

/** `GET /v1/vocab`: today's queue, the categories, the weak cards and tomorrow. */
export interface VocabHub {
  /** True when the language pair has no vocabulary card at all. */
  readonly empty: boolean;
  readonly today: {
    readonly due: number;
    readonly new: number;
    /** 約 K 分: the cards' seconds, rounded up to whole minutes. */
    readonly minutes: number;
  };
  readonly categories: readonly VocabCategoryView[];
  /** The weak cards a weak session would deal from now. */
  readonly weak: number;
  readonly tomorrow: number;
}

/** A dealt card: its front, its back, and what each grade would do. */
export interface VocabCardView {
  readonly id: string;
  readonly category: VocabCategory;
  readonly level: number;
  /** The front: what it means, and an example with its blanks marked `{{…}}`. */
  readonly definition: string;
  readonly example: string;
  /** The back: the answer, its meaning in the learner's first language, another example. */
  readonly headword: string;
  readonly meaning: string;
  readonly example2: string;
  readonly intervals: GradeIntervals;
  /** Never answered before: its first answer introduces it. */
  readonly isNew: boolean;
  /** The learner's own card, made from a talk, which they may delete. */
  readonly personal: boolean;
}

/** `POST /v1/vocab/sessions`: the session and the cards it deals, in order. */
export interface VocabSessionView {
  readonly sessionId: string;
  readonly kind: VocabSession["kind"];
  readonly category: VocabCategory | null;
  readonly day: DayKey;
  readonly cards: readonly VocabCardView[];
}

/** A card whose first answer in the session was graded again. */
export interface VocabAgainRow {
  readonly cardId: string;
  readonly headword: string;
  readonly meaning: string;
}

/** `POST /v1/vocab/sessions/{sessionId}/finish`: what the done screen shows. */
export interface VocabSummary {
  readonly sessionId: string;
  readonly kind: VocabSession["kind"];
  readonly category: VocabCategory | null;
  readonly day: DayKey;
  /** Cards answered in the session. */
  readonly answered: number;
  /** Of those, the cards it introduced. */
  readonly new: number;
  /** The first answers graded again, in the order they were given. */
  readonly again: readonly VocabAgainRow[];
  /** Reviews due tomorrow, as counted when the session finished. */
  readonly tomorrow: number;
}
