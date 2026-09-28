import { App } from "aws-cdk-lib";

import { AppStack } from "./app-stack";
import { DeployAccessStack } from "./deploy-access-stack";
import { FoundationStack } from "./foundation-stack";
import { parseStage, type Stage } from "./stage";

/** Where every stage deploys (ADR-0009). */
export const REGION = "ap-northeast-1";

/**
 * The context key naming the repository's root, absolute or relative to the
 * working directory. `infra/cdk.json` sets it for the CLI, which runs in `infra/`.
 */
export const REPOSITORY_ROOT_CONTEXT = "repository-root";

/** The `repository-root` context value, which a stage building the `app` stack needs, is missing. */
export class MissingRepositoryRootError extends Error {
  readonly code = "ERR_INFRA_REPOSITORY_ROOT" as const;

  constructor(value: unknown) {
    super(
      `The CDK app needs the repository's root to bundle the API: pass it as \`-c ${REPOSITORY_ROOT_CONTEXT}=<path>\` (got ${value === undefined ? "nothing" : JSON.stringify(value)}).`,
    );
    this.name = "MissingRepositoryRootError";
  }
}

/** The CDK app, and the stage it was built for. */
export interface StagedApp {
  readonly app: App;
  readonly stage: Stage;
}

/**
 * Build the CDK app for the stage its `stage` context value names.
 *
 * @remarks
 * The CDK CLI hands `-c stage=<stage>` to the app through the environment,
 * which `App` reads on its own; `context` adds to that, and is how a test
 * builds a stage without the CLI. A missing or unknown stage throws, so
 * synthesis fails before any template is written.
 *
 * Each stack's construct id is the same in every stage, so a CLI command
 * names it the same way (`pnpm cdk deploy -c stage=dev foundation`); its
 * CloudFormation name carries the stage.
 */
export function buildApp(context: Readonly<Record<string, unknown>> = {}): StagedApp {
  const app = new App({ context: { ...context } });
  const stage = parseStage(app.node.tryGetContext("stage"));
  const foundation = new FoundationStack(app, "foundation", {
    stage,
    stackName: `instant-composition-${stage}-foundation`,
    env: { region: REGION },
  });
  // `prod`'s deploy waits behind a manual approval (ADR-0009), which this
  // role's trust does not express, and `prod` is not hosted until the
  // production phases, so only `dev` has either stack until then.
  if (stage === "dev") {
    new DeployAccessStack(app, "deploy-access", {
      stage,
      stackName: `instant-composition-${stage}-deploy-access`,
      env: { region: REGION },
    });
    const repositoryRoot: unknown = app.node.tryGetContext(REPOSITORY_ROOT_CONTEXT);
    if (typeof repositoryRoot !== "string" || repositoryRoot === "") {
      throw new MissingRepositoryRootError(repositoryRoot);
    }
    const hosted = new AppStack(app, "app", {
      stage,
      repositoryRoot,
      stackName: `instant-composition-${stage}-app`,
      env: { region: REGION },
    });
    // Deploy order only: `app` reads foundation's parameters by name, so no
    // value crosses between the two templates.
    hosted.addStackDependency(foundation);
  }
  return { app, stage };
}
