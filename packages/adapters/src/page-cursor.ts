/** Cursor scope is supplied by the bound store, never by an HTTP learner id. */
export function pageCursor(scope: string, after: string): string {
  return encodeURIComponent(JSON.stringify({ scope, after }));
}
export function cursorAfter(
  scope: string,
  cursor: string | undefined,
): string | undefined {
  if (cursor === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(cursor));
  } catch {
    throw new RangeError("Invalid page cursor.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("scope" in parsed) ||
    !("after" in parsed) ||
    parsed.scope !== scope ||
    typeof parsed.after !== "string"
  ) {
    throw new RangeError("The page cursor belongs to another learner or range.");
  }
  return parsed.after;
}
export function pageLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError("A page limit is between 1 and 100.");
}
export function portionBounds(from: string, to: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(to) ||
    from > to
  )
    throw new RangeError("A portion range has ordered ISO day keys.");
}
