import { z } from "zod";

const legacyKey = z.strictObject({ PK: z.string().min(1), SK: z.string().min(1) });

function canonical(value: string): boolean {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length > 0 && encodeURIComponent(decoded) === value;
  } catch {
    return false;
  }
}

/** Historical cursor bytes stay intact; consumption accepts only this exact range. */
export function candidateCursorKey(
  cursor: string,
  prefix: string,
  partition?: string,
): { readonly PK: string; readonly SK: string } | undefined {
  if (cursor.length > 4096) return undefined;
  let key: { readonly PK: string; readonly SK: string };
  if (cursor.startsWith("{")) {
    try {
      const value: unknown = JSON.parse(cursor);
      const parsed = legacyKey.safeParse(value);
      if (!parsed.success) return undefined;
      key = parsed.data;
    } catch {
      return undefined;
    }
  } else {
    const parts = cursor.split("|");
    const [encodedPartition, encodedPrefix, sort] = parts;
    if (
      parts.length !== 3 ||
      encodedPartition === undefined ||
      sort === undefined ||
      !canonical(encodedPartition) ||
      encodedPrefix !== encodeURIComponent(prefix)
    )
      return undefined;
    key = { PK: decodeURIComponent(encodedPartition), SK: sort };
  }
  return key.PK.startsWith("LEARNER#") &&
    canonical(key.PK.slice(8)) &&
    (partition === undefined || key.PK === partition) &&
    key.SK.startsWith(prefix) &&
    key.SK.length > prefix.length
    ? key
    : undefined;
}
