import {
  addBedrockBudget,
  AppStack,
  BEDROCK_DENIED_ACTIONS,
  BEDROCK_MONTHLY_LIMIT_USD,
  bedrockBudgetName,
  buildApp,
  roleOf,
} from "@instant-composition/infra";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import { Topic } from "aws-cdk-lib/aws-sns";
import { describe, expect, it } from "vitest";

import { infraContext } from "./infra-context";

function synthesizeApp(): Template {
  const stack = buildApp(infraContext("dev")).app.node.findChild("app");
  if (!(stack instanceof AppStack)) {
    throw new TypeError("the dev app has no app stack");
  }
  return Template.fromStack(stack);
}

// Synthesized once at collection, outside any test's timeout (#150).
const TEMPLATE = synthesizeApp();

/** A bare stack whose budget covers two roles, as it will once the worker lands. */
function synthesizeTwoRoles(): Template {
  const stack = new Stack(new App(), "two-roles", {
    env: { region: "ap-northeast-1" },
  });
  const role = (id: string): Role =>
    new Role(stack, id, { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
  addBedrockBudget(stack, {
    stage: "dev",
    roles: [role("First"), role("Second")],
    topic: new Topic(stack, "Topic"),
  });
  return Template.fromStack(stack);
}

const TWO_ROLES = synthesizeTwoRoles();

function onlyId(template: Template, type: string, prefix = ""): string {
  const ids = Object.keys(template.findResources(type)).filter((id) =>
    id.startsWith(prefix),
  );
  if (ids.length !== 1 || ids[0] === undefined) {
    throw new TypeError(`the template has no single ${type} named ${prefix}…`);
  }
  return ids[0];
}

function propertiesOf(
  template: Template,
  type: string,
  prefix = "",
): Record<string, unknown> {
  const properties: unknown =
    template.findResources(type)[onlyId(template, type, prefix)]?.["Properties"];
  if (typeof properties !== "object" || properties === null) {
    throw new TypeError(`${type} has no properties`);
  }
  return properties as Record<string, unknown>;
}

const ACCOUNT = { Ref: "AWS::AccountId" };

function arn(...parts: unknown[]): { "Fn::Join": [string, unknown[]] } {
  return { "Fn::Join": ["", ["arn:", { Ref: "AWS::Partition" }, ...parts]] };
}

const API_ROLE = { Ref: onlyId(TEMPLATE, "AWS::IAM::Role", "ApiFunction") };
const DENY_POLICY = { Ref: onlyId(TEMPLATE, "AWS::IAM::ManagedPolicy") };

describe("the dev app stack's Bedrock budget", () => {
  it("is a monthly cost budget on Bedrock and AWS Marketplace spend, credits left out", () => {
    expect(propertiesOf(TEMPLATE, "AWS::Budgets::Budget")).toStrictEqual({
      Budget: {
        BudgetName: "instant-composition-dev-bedrock",
        BudgetType: "COST",
        TimeUnit: "MONTHLY",
        BudgetLimit: { Amount: BEDROCK_MONTHLY_LIMIT_USD, Unit: "USD" },
        Metrics: ["UnblendedCost"],
        FilterExpression: {
          And: [
            {
              Or: [
                { Dimensions: { Key: "SERVICE", Values: ["Amazon Bedrock"] } },
                { Dimensions: { Key: "BILLING_ENTITY", Values: ["AWS Marketplace"] } },
              ],
            },
            { Not: { Dimensions: { Key: "RECORD_TYPE", Values: ["Credit"] } } },
          ],
        },
      },
    });
    expect(bedrockBudgetName("dev")).toBe("instant-composition-dev-bedrock");
  });

  // Budgets actions are free for the first two action-enabled budgets only.
  it("is the stack's one budget and carries its one action", () => {
    expect(Object.keys(TEMPLATE.findResources("AWS::Budgets::Budget"))).toHaveLength(1);
    expect(
      Object.keys(TEMPLATE.findResources("AWS::Budgets::BudgetsAction")),
    ).toHaveLength(1);
  });

  it("attaches the deny policy to the API role automatically once actual spend reaches the limit", () => {
    expect(propertiesOf(TEMPLATE, "AWS::Budgets::BudgetsAction")).toStrictEqual({
      BudgetName: { Ref: onlyId(TEMPLATE, "AWS::Budgets::Budget") },
      ActionType: "APPLY_IAM_POLICY",
      ApprovalModel: "AUTOMATIC",
      NotificationType: "ACTUAL",
      ActionThreshold: { Type: "PERCENTAGE", Value: 100 },
      ExecutionRoleArn: {
        "Fn::GetAtt": [
          onlyId(TEMPLATE, "AWS::IAM::Role", "BedrockBudgetActionRole"),
          "Arn",
        ],
      },
      Definition: {
        IamActionDefinition: { PolicyArn: DENY_POLICY, Roles: [API_ROLE] },
      },
      Subscribers: [
        { Type: "SNS", Address: { Ref: onlyId(TEMPLATE, "AWS::SNS::Topic") } },
      ],
    });
  });

  it("is armed only after its role's permission and the topic's policy exist", () => {
    const action = Object.values(
      TEMPLATE.findResources("AWS::Budgets::BudgetsAction"),
    )[0] as { DependsOn?: string[] };
    expect(action.DependsOn).toEqual(
      expect.arrayContaining([
        onlyId(TEMPLATE, "AWS::IAM::Policy", "BedrockBudgetActionRole"),
        onlyId(TEMPLATE, "AWS::SNS::TopicPolicy"),
      ]),
    );
  });

  it("denies every model invocation and Converse call, attached to no role until the action runs", () => {
    const policy = propertiesOf(TEMPLATE, "AWS::IAM::ManagedPolicy");
    const { Statement: statements, ...document } = policy["PolicyDocument"] as {
      Statement: Record<string, unknown>[];
    };
    expect(document).toStrictEqual({ Version: "2012-10-17" });
    expect(statements).toHaveLength(1);
    const { Action: actions, ...statement } = statements[0] ?? {};
    expect(statement).toStrictEqual({ Effect: "Deny", Resource: "*" });
    // The CLI's minimizePolicies sorts the actions; a test synthesizes without it.
    expect([actions].flat().sort()).toStrictEqual([...BEDROCK_DENIED_ACTIONS].sort());
    expect([...BEDROCK_DENIED_ACTIONS].sort()).toStrictEqual([
      "bedrock:Converse*",
      "bedrock:InvokeModel*",
    ]);
    for (const attachment of ["Roles", "Users", "Groups"]) {
      expect(policy).not.toHaveProperty(attachment);
    }
  });
});

describe("the Bedrock budget action's execution role", () => {
  it("is assumed by Budgets alone, for this account's budgets", () => {
    const role = propertiesOf(TEMPLATE, "AWS::IAM::Role", "BedrockBudgetActionRole");
    expect(role["AssumeRolePolicyDocument"]).toStrictEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "sts:AssumeRole",
          Principal: { Service: "budgets.amazonaws.com" },
          Condition: {
            StringEquals: { "aws:SourceAccount": ACCOUNT },
            ArnLike: { "aws:SourceArn": arn(":budgets::", ACCOUNT, ":budget/*") },
          },
        },
      ],
    });
    expect(role).not.toHaveProperty("ManagedPolicyArns");
    expect(role).not.toHaveProperty("Policies");
  });

  it("may attach and detach only the deny policy, only on the API role", () => {
    const policy = propertiesOf(
      TEMPLATE,
      "AWS::IAM::Policy",
      "BedrockBudgetActionRole",
    );
    expect(policy["Roles"]).toStrictEqual([
      { Ref: onlyId(TEMPLATE, "AWS::IAM::Role", "BedrockBudgetActionRole") },
    ]);
    expect(policy["PolicyDocument"]).toStrictEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["iam:AttachRolePolicy", "iam:DetachRolePolicy"],
          Resource: { "Fn::GetAtt": [API_ROLE.Ref, "Arn"] },
          Condition: { ArnEquals: { "iam:PolicyARN": DENY_POLICY } },
        },
      ],
    });
  });

  it("covers every role it is given, and only those", () => {
    const [first, second] = ["First", "Second"].map((id) =>
      onlyId(TWO_ROLES, "AWS::IAM::Role", id),
    );
    expect(
      propertiesOf(TWO_ROLES, "AWS::Budgets::BudgetsAction")["Definition"],
    ).toStrictEqual({
      IamActionDefinition: {
        PolicyArn: { Ref: onlyId(TWO_ROLES, "AWS::IAM::ManagedPolicy") },
        Roles: [{ Ref: first }, { Ref: second }],
      },
    });
    const document = propertiesOf(TWO_ROLES, "AWS::IAM::Policy")["PolicyDocument"] as {
      Statement: { Resource: unknown }[];
    };
    expect(document.Statement).toHaveLength(1);
    expect(document.Statement[0]?.Resource).toStrictEqual([
      { "Fn::GetAtt": [first, "Arn"] },
      { "Fn::GetAtt": [second, "Arn"] },
    ]);
  });
});

describe("roleOf", () => {
  it("refuses a function that has no execution role in this app", () => {
    const stack = new Stack(new App(), "imported");
    const imported = LambdaFunction.fromFunctionArn(
      stack,
      "Imported",
      "arn:aws:lambda:ap-northeast-1:123456789012:function:elsewhere",
    );
    expect(() => roleOf(imported)).toThrow(TypeError);
  });
});

describe("the alarm topic's policy", () => {
  it("admits Budgets and this stack's alarms, each from this account alone", () => {
    const topic = { Ref: onlyId(TEMPLATE, "AWS::SNS::Topic") };
    const policy = propertiesOf(TEMPLATE, "AWS::SNS::TopicPolicy");
    expect(policy["Topics"]).toStrictEqual([topic]);
    const { Statement: statements } = policy["PolicyDocument"] as {
      Statement: Record<string, unknown>[];
    };
    expect(
      statements.map((statement) =>
        Object.fromEntries(Object.entries(statement).filter(([key]) => key !== "Sid")),
      ),
    ).toStrictEqual([
      {
        Effect: "Allow",
        Action: "sns:Publish",
        Principal: { Service: "cloudwatch.amazonaws.com" },
        Resource: topic,
        Condition: {
          StringEquals: { "aws:SourceAccount": ACCOUNT },
          ArnLike: {
            "aws:SourceArn": arn(":cloudwatch:ap-northeast-1:", ACCOUNT, ":alarm:*"),
          },
        },
      },
      {
        Effect: "Allow",
        Action: "sns:Publish",
        Principal: { Service: "budgets.amazonaws.com" },
        Resource: topic,
        Condition: {
          StringEquals: { "aws:SourceAccount": ACCOUNT },
          ArnLike: { "aws:SourceArn": arn(":budgets::", ACCOUNT, ":*") },
        },
      },
    ]);
  });
});
