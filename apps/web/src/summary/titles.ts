/** A milestone the summary names, read back from the key the API sends for it. */
export type ParsedTitle =
  | { readonly kind: "streak"; readonly value: number }
  | { readonly kind: "reach"; readonly topic: string; readonly value: number };

/**
 * `streak:<days>` or `reach:<topic>:<count>`, the keys a round summary's
 * `titles` carries; anything else is a title this client does not know yet,
 * and is left out rather than shown as its key.
 */
export function parseTitleKey(key: string): ParsedTitle | undefined {
  const streak = /^streak:(\d+)$/u.exec(key);
  if (streak?.[1] !== undefined) {
    return { kind: "streak", value: Number(streak[1]) };
  }
  const reach = /^reach:([^:]+):(\d+)$/u.exec(key);
  if (reach?.[1] !== undefined && reach[2] !== undefined) {
    return { kind: "reach", topic: reach[1], value: Number(reach[2]) };
  }
  return undefined;
}
