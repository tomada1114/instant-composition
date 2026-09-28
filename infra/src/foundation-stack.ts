import { CfnOutput, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import {
  AccountRecovery,
  FeaturePlan,
  Mfa,
  UserPool,
  UserPoolEmail,
} from "aws-cdk-lib/aws-cognito";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { type Construct } from "constructs";

import { type Stage } from "./stage";

/**
 * Whether the learner table is protected by point-in-time recovery and
 * deletion protection. `dev` goes without both until `prod` exists
 * (ADR-0009, Stages).
 */
const TABLE_PROTECTED: Readonly<Record<Stage, boolean>> = {
  dev: false,
  prod: true,
};

/**
 * Whether a learner may sign themselves up. In `dev` only an administrator
 * creates users (`AllowAdminCreateUserOnly`, ADR-0009, Stages).
 */
const SELF_SIGN_UP: Readonly<Record<Stage, boolean>> = {
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
 * the learner table ADR-0006 lays out, and the Cognito user pool ADR-0005
 * signs learners in against.
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

    // The sign-in and username settings cannot change once the pool exists: a
    // changed one replaces the pool, and every learner's `sub` with it.
    new UserPool(this, "UserPool", {
      featurePlan: FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: SELF_SIGN_UP[stage],
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      mfa: Mfa.OFF,
      // `prod` moves to SES with the production-guard phase (ADR-0009, Email),
      // once a verified sending identity exists; until then no stage has one.
      email: UserPoolEmail.withCognito(),
      removalPolicy: RemovalPolicy.RETAIN,
      deletionProtection: true,
    });
  }
}
