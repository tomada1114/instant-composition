import { coreHash } from "../scripts/cards/schema.mjs";
import { makeCard } from "./cards-fixture";

// Cards for the progress-store suites, on top of the `cards:*` fixture root.
// Nothing here asserts.

/** A card carrying a `core` stamp that matches its fields, so the app shows it. */
export function makeShownCard(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const card = makeCard(id, overrides);
  const hash = coreHash(card as unknown as Parameters<typeof coreHash>[0]);
  return {
    ...card,
    stamps: { core: { hash, perspectivesVersion: 2, at: "2026-09-22" } },
  };
}

/**
 * `count` shown cards in one cell, ids `c_<prefix><n>` with distinct text, the
 * level taken from `overrides` (default 1).
 */
export function makeShownCell(
  prefix: string,
  count: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) =>
    makeShownCard(`c_${prefix}${String(index + 1)}`, {
      ja: `${prefix} の文 ${String(index + 1)}`,
      en: `This is sentence ${String(index + 1)} of ${prefix}.`,
      ...overrides,
    }),
  );
}
