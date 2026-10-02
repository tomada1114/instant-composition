/**
 * Whether an example's blanks hold its headword: the lint's rule in
 * `scripts/cards/vocab-rules.mjs`, written again here because a personal card
 * the model writes has to meet it on the server. `tests/domain-vocab-card.test.ts`
 * holds the two to the same examples.
 */

import { INTERCHANGEABLE, IRREGULAR, PLACEHOLDERS } from "./vocab-forms";

/** `text`'s words, lower case, surrounding punctuation and braces dropped. */
export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replaceAll(/[‘’`]/gu, "'")
    .split(/\s+/u)
    .map((token) => token.replaceAll(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((token) => token !== "");
}

/** A word's regular inflections, itself included. */
function regularForms(word: string): Set<string> {
  const forms = new Set([word]);
  for (const suffix of ["s", "es", "ed", "d", "ing", "er", "r", "est", "st"]) {
    forms.add(word + suffix);
  }
  if (word.endsWith("e")) {
    forms.add(`${word.slice(0, -1)}ing`);
    if (word.endsWith("ie")) forms.add(`${word.slice(0, -2)}ying`);
  }
  if (/[^aeiou]y$/u.test(word)) {
    const stem = word.slice(0, -1);
    for (const suffix of ["ies", "ied", "ier", "iest"]) forms.add(stem + suffix);
  }
  if (/[^aeiou][aeiou][bdgklmnprt]$/u.test(word)) {
    const last = word.at(-1) ?? "";
    for (const suffix of ["ed", "ing", "er", "est"]) forms.add(word + last + suffix);
  }
  if (word.endsWith("fe")) forms.add(`${word.slice(0, -2)}ves`);
  else if (word.endsWith("f")) forms.add(`${word.slice(0, -1)}ves`);
  return forms;
}

/** Whether a blanked `word` is a form of the headword's `head`. */
function isFormOf(word: string, head: string): boolean {
  if (regularForms(head).has(word)) return true;
  const irregular = Object.hasOwn(IRREGULAR, head) ? (IRREGULAR[head] ?? []) : [];
  if (irregular.some((form) => form === word || regularForms(form).has(word))) {
    return true;
  }
  return INTERCHANGEABLE.some((group) => group.includes(head) && group.includes(word));
}

/**
 * Whether the blanked words, in order, are the headword's words in some form:
 * every headword word blanked, except a placeholder, which the example may
 * fill in outside the blanks.
 */
export function blanksMatch(
  blanked: readonly string[],
  head: readonly string[],
): boolean {
  const align = (at: number, from: number): boolean => {
    if (at === head.length) return from === blanked.length;
    const word = head[at] ?? "";
    const next = blanked[from];
    if (Object.hasOwn(PLACEHOLDERS, word)) {
      if (align(at + 1, from)) return true;
      const fillers = PLACEHOLDERS[word] ?? null;
      return (
        next !== undefined &&
        (fillers === null || fillers.includes(next)) &&
        align(at + 1, from + 1)
      );
    }
    return next !== undefined && isFormOf(next, word) && align(at + 1, from + 1);
  };
  return align(0, 0);
}
