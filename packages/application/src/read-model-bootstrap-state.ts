export type BootstrapPhase = "discovery" | "preparation" | "verification";

export interface BootstrapCheckpoint {
  readonly schema: 1;
  readonly phase: BootstrapPhase;
  readonly catalog: string;
  readonly cursor: string | null;
  readonly validUntil: number | null;
}

function supportedCursor(cursor: string | null): boolean {
  if (cursor === null) return true;
  try {
    const key: unknown = JSON.parse(cursor);
    return (
      typeof key === "object" &&
      key !== null &&
      Object.keys(key).length === 2 &&
      "PK" in key &&
      "SK" in key &&
      typeof key.PK === "string" &&
      key.PK.length > 0 &&
      typeof key.SK === "string" &&
      key.SK.length > 0
    );
  } catch {
    return false;
  }
}

/** Worker-owned checkpoints are bounded and never interpreted as learner identity. */
export function bootstrapCheckpoint(
  checkpoint: string | null,
  catalog: string,
): BootstrapCheckpoint {
  if (checkpoint === null)
    return { schema: 1, phase: "discovery", catalog, cursor: null, validUntil: null };
  if (checkpoint.length > 8_192)
    throw new TypeError("The bootstrap checkpoint exceeds its bound.");
  const value: unknown = JSON.parse(checkpoint);
  if (
    typeof value !== "object" ||
    value === null ||
    Object.keys(value).some(
      (key) => !["schema", "phase", "catalog", "cursor", "validUntil"].includes(key),
    ) ||
    !("schema" in value) ||
    value.schema !== 1 ||
    !("phase" in value) ||
    (value.phase !== "discovery" &&
      value.phase !== "preparation" &&
      value.phase !== "verification") ||
    !("catalog" in value) ||
    typeof value.catalog !== "string" ||
    !("cursor" in value) ||
    (value.cursor !== null &&
      (typeof value.cursor !== "string" || value.cursor.length > 4_096)) ||
    !("validUntil" in value) ||
    (value.validUntil !== null &&
      (typeof value.validUntil !== "number" || !Number.isFinite(value.validUntil)))
  )
    throw new TypeError("The bootstrap checkpoint is unsupported.");
  if (!supportedCursor(value.cursor))
    throw new TypeError("The bootstrap cursor names one bounded table key.");
  if (
    (value.phase === "preparation" && value.cursor !== null) ||
    (value.phase !== "verification" && value.validUntil !== null)
  )
    throw new TypeError("The bootstrap phase and position disagree.");
  return value.catalog === catalog
    ? {
        schema: 1,
        phase: value.phase,
        catalog,
        cursor: value.cursor,
        validUntil: value.validUntil,
      }
    : {
        schema: 1,
        phase: value.phase === "discovery" ? "discovery" : "preparation",
        catalog,
        cursor: value.phase === "discovery" ? value.cursor : null,
        validUntil: null,
      };
}
