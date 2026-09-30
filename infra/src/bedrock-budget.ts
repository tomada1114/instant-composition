import { Aws, type Stack } from "aws-cdk-lib";
import { CfnBudget, CfnBudgetsAction } from "aws-cdk-lib/aws-budgets";
import {
  Effect,
  type IRole,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { type IFunction } from "aws-cdk-lib/aws-lambda";
import { type ITopic } from "aws-cdk-lib/aws-sns";

import { type Stage } from "./stage";

/** The month's Bedrock spend, in USD, at which the deny policy is attached. */
export const BEDROCK_MONTHLY_LIMIT_USD = 10;

/**
 * What the deny policy refuses. `bedrock:InvokeModel*` is what stops Converse
 * and ConverseStream too, since those are authorized as `InvokeModel` and
 * `InvokeModelWithResponseStream`; `bedrock:Converse*` is kept beside it for
 * ADR-0010's wording and for any Converse action IAM names later.
 */
export const BEDROCK_DENIED_ACTIONS = ["bedrock:InvokeModel*", "bedrock:Converse*"];

/** The Bedrock budget's name, beside the account's hand-made `monthly-30usd` and `zero-spend`. */
export function bedrockBudgetName(stage: Stage): string {
  return `instant-composition-${stage}-bedrock`;
}

/** A function's execution role, which a Lambda function creates whenever it is given none. */
export function roleOf(handler: IFunction): IRole {
  if (handler.role === undefined) {
    throw new TypeError(`${handler.node.path} has no execution role`);
  }
  return handler.role;
}

export interface BedrockBudgetProps {
  readonly stage: Stage;
  /**
   * Every role that calls Bedrock: the deny policy is attached to each of them.
   * The API function's now; the SQS worker's joins it when the worker lands (#279).
   */
  readonly roles: readonly [IRole, ...IRole[]];
  /** Where Budgets reports that the action ran. */
  readonly topic: ITopic;
}

/**
 * ADR-0010's account-level backstop: a monthly budget on Bedrock spend whose
 * action attaches a policy denying model invocation to `roles`, automatically,
 * once actual spend reaches {@link BEDROCK_MONTHLY_LIMIT_USD}. Budgets detaches
 * it again when the next month starts.
 *
 * @remarks
 * Anthropic's models on Bedrock are sold through AWS Marketplace, and their
 * charges appear under the model's own service name, not `Amazon Bedrock`
 * (every Claude model card on docs.aws.amazon.com, checked 2026-09-29). So the
 * budget counts `Amazon Bedrock` or any AWS Marketplace charge: no other
 * Marketplace purchase is planned, and counting too much only trips it early.
 * Credits are left out, so spend a credit covers still counts toward the limit.
 *
 * The first two budgets with actions are free, then $0.10/day each (AWS
 * Budgets pricing, checked 2026-09-29); the account's other budgets alert only.
 */
export function addBedrockBudget(
  scope: Stack,
  { stage, roles, topic }: BedrockBudgetProps,
): CfnBudgetsAction {
  const denyPolicy = new ManagedPolicy(scope, "BedrockDenyPolicy", {
    description: `instant-composition ${stage}: attached by the Bedrock budget's action`,
    statements: [
      new PolicyStatement({
        effect: Effect.DENY,
        actions: BEDROCK_DENIED_ACTIONS,
        resources: ["*"],
      }),
    ],
  });

  // Budgets documents this source ARN as `budget/*` for every budget, so the
  // trust is narrowed to the account's budgets and the permission to the one
  // policy on these roles.
  const executionRole = new Role(scope, "BedrockBudgetActionRole", {
    description: `instant-composition ${stage}: Budgets attaches the Bedrock deny policy`,
    assumedBy: new ServicePrincipal("budgets.amazonaws.com").withConditions({
      StringEquals: { "aws:SourceAccount": Aws.ACCOUNT_ID },
      ArnLike: {
        "aws:SourceArn": `arn:${Aws.PARTITION}:budgets::${Aws.ACCOUNT_ID}:budget/*`,
      },
    }),
  });
  executionRole.addToPolicy(
    new PolicyStatement({
      actions: ["iam:AttachRolePolicy", "iam:DetachRolePolicy"],
      resources: roles.map((role) => role.roleArn),
      conditions: { ArnEquals: { "iam:PolicyARN": denyPolicy.managedPolicyArn } },
    }),
  );

  const published = topic.addToResourcePolicy(
    new PolicyStatement({
      principals: [new ServicePrincipal("budgets.amazonaws.com")],
      actions: ["sns:Publish"],
      resources: [topic.topicArn],
      conditions: {
        StringEquals: { "aws:SourceAccount": Aws.ACCOUNT_ID },
        ArnLike: {
          "aws:SourceArn": `arn:${Aws.PARTITION}:budgets::${Aws.ACCOUNT_ID}:*`,
        },
      },
    }),
  );

  const budget = new CfnBudget(scope, "BedrockBudget", {
    budget: {
      budgetName: bedrockBudgetName(stage),
      budgetType: "COST",
      timeUnit: "MONTHLY",
      budgetLimit: { amount: BEDROCK_MONTHLY_LIMIT_USD, unit: "USD" },
      metrics: ["UnblendedCost"],
      filterExpression: {
        and: [
          {
            or: [
              { dimensions: { key: "SERVICE", values: ["Amazon Bedrock"] } },
              { dimensions: { key: "BILLING_ENTITY", values: ["AWS Marketplace"] } },
            ],
          },
          { not: { dimensions: { key: "RECORD_TYPE", values: ["Credit"] } } },
        ],
      },
    },
  });

  const action = new CfnBudgetsAction(scope, "BedrockBudgetAction", {
    budgetName: budget.ref,
    actionType: "APPLY_IAM_POLICY",
    approvalModel: "AUTOMATIC",
    notificationType: "ACTUAL",
    actionThreshold: { type: "PERCENTAGE", value: 100 },
    executionRoleArn: executionRole.roleArn,
    definition: {
      iamActionDefinition: {
        policyArn: denyPolicy.managedPolicyArn,
        roles: roles.map((role) => role.roleName),
      },
    },
    subscribers: [{ type: "SNS", address: topic.topicArn }],
  });
  // The action is armed only once the role may attach the policy and the
  // topic admits Budgets, not merely once the role exists.
  action.node.addDependency(executionRole);
  if (published.policyDependable !== undefined) {
    action.node.addDependency(published.policyDependable);
  }
  return action;
}
