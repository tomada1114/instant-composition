/** Private cursor from a trusted system page; never accepted from an HTTP caller. */
export function maintenancePageKey(
  cursor: string | null,
): { readonly PK: string; readonly SK: string } | undefined {
  if (cursor === null) return undefined;
  if (cursor.length > 4096) throw new RangeError("A maintenance cursor is bounded.");
  const parsed: unknown = JSON.parse(cursor);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("PK" in parsed) ||
    !("SK" in parsed) ||
    typeof parsed.PK !== "string" ||
    typeof parsed.SK !== "string" ||
    parsed.PK.length === 0 ||
    parsed.SK.length === 0 ||
    Object.keys(parsed).length !== 2
  )
    throw new RangeError("A maintenance cursor names one table key.");
  return { PK: parsed.PK, SK: parsed.SK };
}
