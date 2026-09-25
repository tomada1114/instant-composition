import { App } from "aws-cdk-lib";

import { DeployAccessStack } from "./deploy-access-stack";
import { FoundationStack } from "./foundation-stack";
import { parseStage, type Stage } from "./stage";

/** Where every stage deploys (ADR-0009). */
export const REGION = "ap-northeast-1";

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
  new FoundationStack(app, "foundation", {
    stage,
    stackName: `instant-composition-${stage}-foundation`,
    env: { region: REGION },
  });
  // `prod`'s deploy waits behind a manual approval (ADR-0009), which this
  // role's trust does not express, so only `dev` has one until that phase.
  if (stage === "dev") {
    new DeployAccessStack(app, "deploy-access", {
      stage,
      stackName: `instant-composition-${stage}-deploy-access`,
      env: { region: REGION },
    });
  }
  return { app, stage };
}
