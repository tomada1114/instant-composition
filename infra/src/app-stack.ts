import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import { CfnStage, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  type IBucket,
} from "aws-cdk-lib/aws-s3";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { type Construct } from "constructs";

import { addApiFunction, TALK_MODEL } from "./api-function";
import { addBedrockBudget, roleOf } from "./bedrock-budget";
import { addDistribution } from "./distribution";
import { addObservability } from "./observability";
import { addSpaDeployment } from "./spa-deployment";
import {
  FOUNDATION_PARAMETERS,
  type FoundationParameter,
  foundationParameterName,
} from "./foundation-parameters";
import { type Stage } from "./stage";
import { addHostedWebClient } from "./web-client";

/** The stack output the `dev` URL is read from. */
export const WEB_URL_OUTPUT = "WebUrl";

/** The stack output the SPA bucket's name is read from, for the web build's upload. */
export const SPA_BUCKET_NAME_OUTPUT = "SpaBucketName";

/** The stack output the distribution's id is read from, for an invalidation. */
export const DISTRIBUTION_ID_OUTPUT = "DistributionId";

/**
 * The `SecureString` parameter the hosted web app client's secret is kept in.
 * CloudFormation cannot write a `SecureString`, so the stack's custom resource
 * copies the secret in, and no template ever holds it.
 */
export function webClientSecretParameterName(stage: Stage): string {
  return `/instant-composition/${stage}/app/web-client-secret`;
}

/** The talk operations' routes, on the same integration as every other path. */
export const TALK_ROUTE_PATHS = ["/api/v1/talks", "/api/v1/talks/{proxy+}"] as const;

/**
 * Each talk route's throttle on the `$default` stage, in CloudFormation's own
 * casing: `RouteSettings` is untyped JSON, which the CDK passes through as is.
 */
export const TALK_ROUTE_THROTTLE = {
  ThrottlingRateLimit: 2,
  ThrottlingBurstLimit: 10,
} as const;

export interface AppStackProps extends StackProps {
  readonly stage: Stage;
  /**
   * The repository's root, absolute or relative to the working directory:
   * the function is bundled from `apps/api` and the catalog from `content/`.
   */
  readonly repositoryRoot: string;
  /** The address the alarm topic mails, from deploy-time context; never committed. */
  readonly alarmEmail?: string | undefined;
  /** The web client's build to upload, from deploy-time context; nothing is uploaded without it. */
  readonly webDist?: string | undefined;
  /**
   * The `CLOUDFRONT`-scope web ACL the distribution's plan requires, which
   * only us-east-1 can hold, so it arrives from the `edge` stack.
   */
  readonly webAclArn: string;
}

/**
 * What is rebuilt often: CloudFront in front of the SPA bucket
 * and, under `/api/*`, API Gateway's HTTP API and the API on Lambda.
 *
 * @remarks
 * Foundation's identifiers are read from Parameter Store by name when the
 * stack deploys, never through a CloudFormation export, so either stack
 * updates on its own and `foundation` knows nothing of this one. The `edge`
 * stack's web ACL arrives as `webAclArn`, read across Regions by output name.
 */
export class AppStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    { stage, repositoryRoot, alarmEmail, webDist, webAclArn, ...props }: AppStackProps,
  ) {
    super(scope, id, props);
    const foundation = (parameter: FoundationParameter): string =>
      StringParameter.valueForStringParameter(
        this,
        foundationParameterName(stage, parameter),
      );

    const bucket = new Bucket(this, "SpaBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });
    const api = new HttpApi(this, "HttpApi", {
      description: `instant-composition ${stage}: the API behind CloudFront's /api/*`,
    });
    // `Bucket` declares `isWebsite` optional where `IBucket` requires it, which
    // exactOptionalPropertyTypes refuses; the value is the same object.
    const origin: IBucket = bucket as IBucket;
    const distribution = addDistribution(this, {
      stage,
      bucket: origin,
      api,
      webAclArn,
    });
    const webUrl = `https://${distribution.distributionDomainName}`;
    const webClient = addHostedWebClient(this, {
      userPoolId: foundation(FOUNDATION_PARAMETERS.userPoolId),
      userPoolArn: foundation(FOUNDATION_PARAMETERS.userPoolArn),
      webUrl,
      secretParameterName: webClientSecretParameterName(stage),
    });

    const tableName = foundation(FOUNDATION_PARAMETERS.learnerTableName);
    const handler = addApiFunction(this, {
      repositoryRoot,
      tableName,
      tableArn: foundation(FOUNDATION_PARAMETERS.learnerTableArn),
      userPoolId: foundation(FOUNDATION_PARAMETERS.userPoolId),
      clientId: webClient.clientId,
      signInDomainUrl: foundation(FOUNDATION_PARAMETERS.signInDomainUrl),
      clientSecretParameter: webClientSecretParameterName(stage),
      webUrl,
      talkModel: TALK_MODEL[stage],
    });
    // A replaced client's function never starts before its secret is written.
    handler.node.addDependency(webClient.secretWritten);
    const integration = new HttpLambdaIntegration("ApiIntegration", handler);
    api.addRoutes({ path: "/{proxy+}", integration });
    const talkRoutes = TALK_ROUTE_PATHS.flatMap((path) =>
      api.addRoutes({ path, methods: [HttpMethod.ANY], integration }),
    );
    // Every talk turn bills the model provider, so its routes are throttled
    // at the stage (AGENTS.md's "Rate limiting"); the stage may only name a
    // route that already exists.
    const defaultStage = api.defaultStage?.node.defaultChild;
    if (!(defaultStage instanceof CfnStage)) {
      throw new TypeError(`${api.node.path} has no default stage`);
    }
    defaultStage.routeSettings = Object.fromEntries(
      TALK_ROUTE_PATHS.map((path) => [`ANY ${path}`, TALK_ROUTE_THROTTLE]),
    );
    for (const route of talkRoutes) defaultStage.node.addDependency(route);

    const sns = addObservability(this, { stage, api, handler, tableName, alarmEmail });
    addBedrockBudget(this, { stage, roles: [roleOf(handler)], topic: sns });
    if (webDist !== undefined) {
      addSpaDeployment(this, { bucket: origin, distribution, webDist });
    }

    new CfnOutput(this, WEB_URL_OUTPUT, { value: webUrl });
    new CfnOutput(this, SPA_BUCKET_NAME_OUTPUT, { value: bucket.bucketName });
    new CfnOutput(this, DISTRIBUTION_ID_OUTPUT, {
      value: distribution.distributionId,
    });
  }
}
