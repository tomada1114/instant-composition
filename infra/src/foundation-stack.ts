import { CfnOutput, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { type Construct } from "constructs";

import { type Stage } from "./stage";

/**
 * Whether the learner table is protected by point-in-time recovery and
 * deletion protection. In `dev` both wait for the account's Paid plan
 * (ADR-0009, Stages; #101 turns them on there).
 */
const TABLE_PROTECTED: Readonly<Record<Stage, boolean>> = {
  dev: false,
  prod: true,
};

/** The stack output a later stack, or a local run, reads the table's name from. */
export const LEARNER_TABLE_NAME_OUTPUT = "LearnerTableName";

export interface FoundationStackProps extends StackProps {
  readonly stage: Stage;
}

/**
 * The stateful resources, rarely changed and retained on delete (ADR-0009):
 * for now, the learner table ADR-0006 lays out.
 */
export class FoundationStack extends Stack {
  constructor(scope: Construct, id: string, { stage, ...props }: FoundationStackProps) {
    super(scope, id, props);
    const isProtected = TABLE_PROTECTED[stage];
    // The key names are packages/adapters' `LEARNER_TABLE_KEY`, which this
    // package may not import; tests/infra-foundation.test.ts holds them equal.
    const table = new Table(this, "LearnerTable", {
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "SK", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      // `Retain` on delete and on replacement in every stage: the owner's own
      // learning history accumulates in `dev` too.
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProtected },
      deletionProtection: isProtected,
    });
    new CfnOutput(this, LEARNER_TABLE_NAME_OUTPUT, { value: table.tableName });
  }
}
