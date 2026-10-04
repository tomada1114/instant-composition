import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

/** AttributeValue JSON adds these exact ASCII wrappers to a declared JSON value. */
function wireOverhead(value: unknown): number {
  if (value === null) return 9;
  if (typeof value === "string") return 6;
  if (typeof value === "number") return 8;
  if (typeof value === "boolean") return 9;
  if (Array.isArray(value))
    return 6 + value.reduce<number>((sum, child) => sum + wireOverhead(child), 0);
  if (typeof value !== "object")
    throw new TypeError("A storage value has no declared wire representation.");
  return (
    6 +
    Object.values(value).reduce<number>((sum, child) => sum + wireOverhead(child), 0)
  );
}
/** Count the complete marshalled payload, including raw-preimage expression values. */
export function checkStorageBudget(items: readonly TransactItem[]): void {
  const keys = items.map((item) => {
    const operation = item.Put ?? item.Update ?? item.Delete ?? item.ConditionCheck;
    if (operation === undefined) throw new TypeError("A transaction action is absent.");
    const key =
      item.Put?.Item ??
      item.Update?.Key ??
      item.Delete?.Key ??
      item.ConditionCheck?.Key;
    return JSON.stringify([key?.["PK"], key?.["SK"]]);
  });
  if (items.length > 100 || new Set(keys).size !== keys.length)
    throw new RangeError("A transaction names at most100 distinct storage keys.");
  let overhead = 0;
  for (const item of items)
    for (const operation of Object.values(item)) {
      for (const field of ["Item", "Key", "ExpressionAttributeValues"] as const) {
        const value: unknown = Reflect.get(operation as object, field);
        if (value !== undefined) overhead += wireOverhead(value);
      }
    }
  // Wrapping the three root maps as M is conservative by six bytes per map.
  const plain = new TextEncoder().encode(
    JSON.stringify({ TransactItems: items }),
  ).byteLength;
  if (plain + overhead > 4 * 1024 * 1024)
    throw new RangeError(
      "A complete storage transaction exceeds its bounded wire budget.",
    );
}
