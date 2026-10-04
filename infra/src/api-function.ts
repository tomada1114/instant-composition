import { Aws, Duration, Stack } from "aws-cdk-lib";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  Architecture,
  ParamsAndSecretsLayerVersion,
  ParamsAndSecretsLogLevel,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { type Construct } from "constructs";
import { type Stage } from "./stage";

/**
 * The AWS Parameters and Secrets Lambda extension, arm64, in `ap-northeast-1`.
 *
 * @remarks
 * aws-cdk-lib's own table stops at layer version 4 (extension 1.0.103, 2023);
 * this is the version AWS lists for the Region, checked 2026-09-28 at
 * https://docs.aws.amazon.com/systems-manager/latest/userguide/ps-integration-lambda-extensions.html.
 * The layer must match the function's architecture and Region.
 */
export const PARAMETERS_EXTENSION_LAYER_ARN =
  "arn:aws:lambda:ap-northeast-1:133490724326:layer:AWS-Parameters-and-Secrets-Lambda-Extension-Arm64:124";

/**
 * Where the function reads the catalog snapshot: the bundle is unpacked in
 * `/var/task`, and the snapshot is written into it as `catalog/<target>/<l1>.json`.
 */
export const LAMBDA_CATALOG_PATH = "/var/task/catalog/en/ja.json";

/** The language model the talk activity calls, and where its key is kept. */
export interface TalkModelSetting {
  readonly provider: "openrouter";
  readonly modelId: string;
  /** The `SecureString` parameter the owner creates by hand: its name only. */
  readonly keyParameter: string;
}

/** Each stage's talk model; the function reads these from #328 on. */
export const TALK_MODEL: Readonly<Record<Stage, TalkModelSetting>> = {
  dev: {
    provider: "openrouter",
    modelId: "anthropic/claude-haiku-4.5",
    keyParameter: "/instant-composition/dev/app/openrouter-api-key",
  },
  prod: {
    provider: "openrouter",
    modelId: "anthropic/claude-haiku-4.5",
    keyParameter: "/instant-composition/prod/app/openrouter-api-key",
  },
};

/**
 * The function's timeout: a talk turn waits on two model calls, and it stays
 * under API Gateway's 30 s integration limit and CloudFront's 30 s origin timeout.
 */
export const API_FUNCTION_TIMEOUT_SECONDS = 25;

/** What the API on Lambda is configured with; every value may be a deploy-time token. */
export interface ApiFunctionProps {
  /** The repository's root, absolute or relative to the working directory. */
  readonly repositoryRoot: string;
  readonly tableName: string;
  readonly tableArn: string;
  readonly userPoolId: string;
  readonly clientId: string;
  /** The user pool domain's base URL. */
  readonly signInDomainUrl: string;
  /** The `SecureString` parameter holding the web app client's secret: its name only. */
  readonly clientSecretParameter: string;
  /** The web client's https origin, which the cookie path admits and Cognito redirects to. */
  readonly webUrl: string;
  readonly talkModel: TalkModelSetting;
}

/**
 * The hosted entry, `apps/api/src/lambda.ts`, bundled with esbuild and the
 * catalog snapshot, and allowed the learner table and the two secret
 * parameters it reads: nothing in a VPC, and nothing else in IAM
 * but writing its own logs.
 */
export function addApiFunction(
  scope: Construct,
  props: ApiFunctionProps,
): NodejsFunction {
  const { repositoryRoot: root, webUrl } = props;
  const handler = new NodejsFunction(scope, "ApiFunction", {
    entry: `${root}/apps/api/src/lambda.ts`,
    handler: "release.handler",
    projectRoot: root,
    depsLockFilePath: `${root}/pnpm-lock.yaml`,
    runtime: Runtime.NODEJS_24_X,
    architecture: Architecture.ARM_64,
    memorySize: 512,
    timeout: Duration.seconds(API_FUNCTION_TIMEOUT_SECONDS),
    logGroup: new LogGroup(scope, "ApiFunctionLogs", {
      retention: RetentionDays.ONE_MONTH,
    }),
    paramsAndSecrets: ParamsAndSecretsLayerVersion.fromVersionArn(
      PARAMETERS_EXTENSION_LAYER_ARN,
      { logLevel: ParamsAndSecretsLogLevel.WARN },
    ),
    environment: {
      API_TABLE_NAME: props.tableName,
      API_CATALOG_PATH: LAMBDA_CATALOG_PATH,
      API_COGNITO_USER_POOL_ID: props.userPoolId,
      API_COGNITO_CLIENT_ID: props.clientId,
      API_COGNITO_DOMAIN: props.signInDomainUrl,
      API_COGNITO_CLIENT_SECRET_PARAMETER: props.clientSecretParameter,
      API_WEB_ORIGINS: webUrl,
      API_WEB_CALLBACK_URL: `${webUrl}/api/v1/auth/callback`,
      API_WEB_SIGN_OUT_URL: `${webUrl}/`,
      API_MODEL_PROVIDER: props.talkModel.provider,
      API_MODEL_ID: props.talkModel.modelId,
      API_OPENROUTER_KEY_PARAMETER: props.talkModel.keyParameter,
    },
    bundling: {
      format: OutputFormat.ESM,
      target: "node24",
      mainFields: ["module", "main"],
      // The AWS SDK is bundled at the lockfile's version rather than taken
      // from the runtime, so the function runs what the tests ran.
      externalModules: [],
      // The snapshot is built from content/ into the bundle itself, so a
      // deploy never ships a catalog older than the checkout it bundles.
      commandHooks: {
        beforeBundling: () => [],
        beforeInstall: () => [],
        afterBundling: (inputDir: string, outputDir: string) => [
          `node "${inputDir}/scripts/catalog/build.mjs" --out "${outputDir}/catalog"`,
          `node "${inputDir}/scripts/release.mjs" bundle "${inputDir}" "${outputDir}"`,
        ],
      },
    },
  });

  Table.fromTableArn(scope, "LearnerTable", props.tableArn).grantReadWriteData(handler);
  const { region, account, urlSuffix } = Stack.of(scope);
  for (const parameter of [props.clientSecretParameter, props.talkModel.keyParameter]) {
    const parameterArn = `arn:${Aws.PARTITION}:ssm:${region}:${account}:parameter${parameter}`;
    handler.addToRolePolicy(
      new PolicyStatement({ actions: ["ssm:GetParameter"], resources: [parameterArn] }),
    );
    // Whichever key the parameter is encrypted with, only a decryption
    // Parameter Store asks for, of that one parameter.
    handler.addToRolePolicy(
      new PolicyStatement({
        actions: ["kms:Decrypt"],
        resources: [`arn:${Aws.PARTITION}:kms:${region}:${account}:key/*`],
        conditions: {
          StringEquals: {
            "kms:ViaService": `ssm.${region}.${urlSuffix}`,
            "kms:EncryptionContext:PARAMETER_ARN": parameterArn,
          },
        },
      }),
    );
  }
  return handler;
}
