/** The four kinds of vocabulary card, one `content/vocab/<category>.json` each. */
export type VocabCategory = "word" | "idiom" | "phrasal-verb" | "phrase";

/**
 * A reviewed vocabulary card with its meaning in the document's first
 * language; a card with no reviewed meaning in it is not in the document.
 */
export interface VocabItem {
  readonly id: string;
  readonly target: string;
  readonly category: VocabCategory;
  readonly level: number;
  /** The answer, in its base form. */
  readonly headword: string;
  readonly definition: string;
  /**
   * One sentence, or for a `phrase` two lines `A: …` / `B: …`, with the
   * headword's words marked `{{…}}`.
   */
  readonly example: string;
  readonly example2: string;
  /** In the document's first language, `CatalogDocument.l1`. */
  readonly meaning: string;
}
