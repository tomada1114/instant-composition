import { type Stage } from "./stage";

/**
 * The foundation identifiers published to SSM Parameter Store, by the last
 * segment of each parameter's name. The `app` stack reads them by name rather
 * than through stack exports, so either stack updates on its own (ADR-0009).
 */
export const FOUNDATION_PARAMETERS = {
  learnerTableName: "learner-table-name",
  learnerTableArn: "learner-table-arn",
  userPoolId: "user-pool-id",
  userPoolArn: "user-pool-arn",
  webClientId: "web-client-id",
  signInDomainUrl: "sign-in-domain-url",
} as const;

export type FoundationParameter =
  (typeof FOUNDATION_PARAMETERS)[keyof typeof FOUNDATION_PARAMETERS];

/** The stage-scoped path every foundation parameter sits under. */
export function foundationParameterPath(stage: Stage): string {
  return `/instant-composition/${stage}/foundation`;
}

/** The full SSM name of one foundation parameter in a stage. */
export function foundationParameterName(
  stage: Stage,
  parameter: FoundationParameter,
): string {
  return `${foundationParameterPath(stage)}/${parameter}`;
}
