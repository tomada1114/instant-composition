import { App, Fn } from "aws-cdk-lib";

import { AppStack } from "./app-stack";
import { DeployAccessStack } from "./deploy-access-stack";
import { EdgeStack, WEB_ACL_ARN_OUTPUT } from "./edge-stack";
import { FoundationStack } from "./foundation-stack";
import { ALARM_EMAIL_CONTEXT } from "./observability";
import { WEB_DIST_CONTEXT } from "./spa-deployment";
import { parseStage, type Stage } from "./stage";

/** Where every stage deploys (ADR-0009), but for what CloudFront needs from {@link EDGE_REGION}. */
export const REGION = "ap-northeast-1";

/** The one Region a `CLOUDFRONT`-scope web ACL can be created in. */
export const EDGE_REGION = "us-east-1";

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
 *
 * `app` reads the `edge` stack's web ACL ARN with `Fn::GetStackOutput`, the
 * one value that crosses Regions: Parameter Store, which carries
 * foundation's identifiers, is regional, and a CDK cross-Region reference
 * would add a custom resource to each stack.
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
  // production phases, so only `dev` has the deploy role or the hosted stacks
  // until then.
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
    const alarmEmail: unknown = app.node.tryGetContext(ALARM_EMAIL_CONTEXT);
    const webDist: unknown = app.node.tryGetContext(WEB_DIST_CONTEXT);
    const edge = new EdgeStack(app, "edge", {
      stage,
      stackName: `instant-composition-${stage}-edge`,
      env: { region: EDGE_REGION },
    });
    const hosted = new AppStack(app, "app", {
      stage,
      repositoryRoot,
      webAclArn: Fn.getStackOutput(edge.stackName, WEB_ACL_ARN_OUTPUT, EDGE_REGION),
      alarmEmail:
        typeof alarmEmail === "string" && alarmEmail !== "" ? alarmEmail : undefined,
      webDist: typeof webDist === "string" && webDist !== "" ? webDist : undefined,
      stackName: `instant-composition-${stage}-app`,
      env: { region: REGION },
    });
    // Deploy order only: `app` reads foundation's parameters and edge's
    // output by name, so no reference ties the templates together.
    hosted.addStackDependency(foundation);
    hosted.addStackDependency(edge);
  }
  return { app, stage };
}
