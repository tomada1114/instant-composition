import { fileURLToPath } from "node:url";

import { REPOSITORY_ROOT_CONTEXT } from "@instant-composition/infra";

/** This checkout's root, which `infra/cdk.json` names as `..` for the CLI running in `infra/`. */
export const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * The context a test builds the CDK app with: the stage, the repository root
 * the API is bundled from, and no stack's assets bundled, so synthesis runs
 * neither esbuild nor the catalog build. `tests/infra-api-bundle.test.ts` is
 * the one suite that bundles.
 */
export function infraContext(stage: unknown): Record<string, unknown> {
  return {
    stage,
    [REPOSITORY_ROOT_CONTEXT]: REPOSITORY_ROOT,
    "aws:cdk:bundling-stacks": [],
  };
}
