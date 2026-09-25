/** Every stage the one CDK app builds (ADR-0009, Stages). */
export const STAGES = ["dev", "prod"] as const;

export type Stage = (typeof STAGES)[number];

/** The `stage` context value named no stage in {@link STAGES}. */
export class UnknownStageError extends Error {
  readonly code = "ERR_INFRA_UNKNOWN_STAGE" as const;

  constructor(value: unknown) {
    super(
      `The CDK app needs a stage, one of ${STAGES.join(" | ")}: pass it as \`-c stage=<stage>\` (got ${value === undefined ? "nothing" : JSON.stringify(value)}).`,
    );
    this.name = "UnknownStageError";
  }
}

function isStage(value: unknown): value is Stage {
  return STAGES.some((stage) => stage === value);
}

/** `value` as a {@link Stage}, or an {@link UnknownStageError} thrown. */
export function parseStage(value: unknown): Stage {
  if (!isStage(value)) throw new UnknownStageError(value);
  return value;
}
