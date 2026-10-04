import { Duration } from "aws-cdk-lib";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

import { LAMBDA_CATALOG_PATH } from "./api-function";
import { declareStorageWriter } from "./storage-writers";

/** Day preparation runs independently of screen visits, with a retained DynamoDB checkpoint. */
export function addReadModelWorker(
  scope: Construct,
  props: {
    readonly repositoryRoot: string;
    readonly tableName: string;
    readonly tableArn: string;
  },
): NodejsFunction {
  const root = props.repositoryRoot;
  const worker = new NodejsFunction(scope, "ReadModelWorker", {
    entry: `${root}/apps/api/src/read-model-worker.ts`,
    handler: "storage.handler",
    projectRoot: root,
    depsLockFilePath: `${root}/pnpm-lock.yaml`,
    runtime: Runtime.NODEJS_24_X,
    architecture: Architecture.ARM_64,
    memorySize: 512,
    timeout: Duration.seconds(60),
    // Unreserved: an account at Lambda's default quota of ten can reserve none,
    // and overlapping invocations already serialize through the checkpoint CAS.
    logGroup: new LogGroup(scope, "ReadModelWorkerLogs", {
      retention: RetentionDays.ONE_MONTH,
    }),
    environment: {
      API_TABLE_NAME: props.tableName,
      API_CATALOG_PATH: LAMBDA_CATALOG_PATH,
    },
    bundling: {
      format: OutputFormat.ESM,
      target: "node24",
      mainFields: ["module", "main"],
      externalModules: [],
      commandHooks: {
        beforeBundling: () => [],
        beforeInstall: () => [],
        afterBundling: (inputDir: string, outputDir: string) => [
          `node "${inputDir}/scripts/catalog/build.mjs" --out "${outputDir}/catalog"`,
          `node "${inputDir}/scripts/release.mjs" bundle "${inputDir}" "${outputDir}"`,
          `node "${inputDir}/scripts/storage-bundle.mjs" "${inputDir}" "${outputDir}"`,
          `node "${inputDir}/scripts/release.mjs" bundle "${inputDir}" "${outputDir}"`,
        ],
      },
    },
  });
  declareStorageWriter(scope, worker, null);
  Table.fromTableArn(scope, "ReadModelWorkerTable", props.tableArn).grantReadWriteData(
    worker,
  );
  new Rule(scope, "ReadModelSchedule", {
    schedule: Schedule.rate(Duration.minutes(1)),
    targets: [
      new LambdaFunction(worker, {
        retryAttempts: 2,
        maxEventAge: Duration.minutes(5),
      }),
    ],
  });
  return worker;
}
