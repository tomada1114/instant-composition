import { CfnFunction } from "aws-cdk-lib/aws-lambda";
import { type NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { type Construct } from "constructs";

/** Deployment-only context; the immutable transition assembly keeps every writer paused. */
export const STORAGE_WRITERS_PAUSED_CONTEXT = "storage-writers-paused";
export const STORAGE_WRITER_ARNS_CONTEXT = "storage-writer-arns";
export const STORAGE_CAPACITY_METADATA = "instant-composition:storage-capacity";

/** Invalid deployment admission settings fail synthesis before credentials or writes. */
export class StorageWriterConfigurationError extends Error {
  readonly code = "ERR_INFRA_STORAGE_WRITERS" as const;

  constructor() {
    super(
      "ERR_INFRA_STORAGE_WRITERS: Expected a boolean pause and exact owned dev writer ARNs. Next: discover writers from the owned app stack before synthesizing deploy access.",
    );
    this.name = "StorageWriterConfigurationError";
  }
}

export function storageWritersPaused(scope: Construct): boolean {
  const value: unknown = scope.node.tryGetContext(STORAGE_WRITERS_PAUSED_CONTEXT);
  if (value === undefined || value === false || value === "false") return false;
  if (value === true || value === "true") return true;
  throw new StorageWriterConfigurationError();
}

/** The operator verifies physical resources against CloudFormation before supplying these ARNs. */
export function storageWriterArns(scope: Construct): readonly string[] {
  const value: unknown = scope.node.tryGetContext(STORAGE_WRITER_ARNS_CONTEXT);
  if (value === undefined) return [];
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new StorageWriterConfigurationError();
    }
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > 2 ||
    !parsed.every(
      (arn: unknown) =>
        typeof arn === "string" &&
        /^arn:aws:lambda:ap-northeast-1:[0-9]{12}:function:instant-composition-dev-app-(ApiFunction|ReadModelWorker)[A-Za-z0-9-]+$/.test(
          arn,
        ),
    ) ||
    new Set(parsed).size !== parsed.length
  )
    throw new StorageWriterConfigurationError();
  return parsed as string[];
}

/** Desired capacity stays recorded even while CloudFormation declares zero. */
export function declareStorageWriter(
  scope: Construct,
  handler: NodejsFunction,
  capacity: number | null,
): void {
  const resource = handler.node.defaultChild;
  if (!(resource instanceof CfnFunction)) throw new StorageWriterConfigurationError();
  resource.addMetadata(STORAGE_CAPACITY_METADATA, capacity ?? "unreserved");
  if (storageWritersPaused(scope)) resource.reservedConcurrentExecutions = 0;
}
