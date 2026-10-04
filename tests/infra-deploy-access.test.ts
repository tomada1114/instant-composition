import {
  buildApp,
  AppStack,
  StorageWriterConfigurationError,
  DEPLOY_ROLE_ARN_OUTPUT,
  DeployAccessStack,
} from "@instant-composition/infra";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { infraContext } from "./infra-context";

function synthesizeDeployAccess(): Template {
  const stack = buildApp(infraContext("dev")).app.node.findChild("deploy-access");
  if (!(stack instanceof DeployAccessStack)) {
    throw new TypeError("the dev app has no deploy-access stack");
  }
  return Template.fromStack(stack);
}

// Synthesized once at collection, outside any test's timeout: the first
// synthesis loads aws-cdk-lib and alone takes seconds (#150).
const TEMPLATE = synthesizeDeployAccess();

function deployAccessTemplate(): Template {
  return TEMPLATE;
}

function onlyResource(template: Template, type: string): Record<string, unknown> {
  const resources = Object.values(template.findResources(type));
  expect(resources).toHaveLength(1);
  const [resource] = resources;
  if (resource === undefined) throw new TypeError(`no ${type}`);
  return resource;
}

describe("the dev deploy-access stack", () => {
  it("registers GitHub's OIDC issuer for the STS audience", () => {
    const provider = onlyResource(deployAccessTemplate(), "AWS::IAM::OIDCProvider");
    expect(provider["Properties"]).toMatchObject({
      Url: "https://token.actions.githubusercontent.com",
      ClientIdList: ["sts.amazonaws.com"],
    });
  });

  it("lets only this repository's main branch assume the deploy role", () => {
    const role = onlyResource(deployAccessTemplate(), "AWS::IAM::Role");
    expect(role["Properties"]).toMatchObject({
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: "sts:AssumeRoleWithWebIdentity",
            Effect: "Allow",
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub":
                  "repo:tomada1114@68495563/instant-composition@1382590627:ref:refs/heads/main",
              },
            },
          },
        ],
      },
    });
    const trust = JSON.stringify(role["Properties"]);
    expect(trust.match(/"Action"/g)).toHaveLength(1);
    // A second condition operator could only widen the subjects matched.
    expect(trust.match(/"String\w+":/g)).toStrictEqual(['"StringEquals":']);
    expect(trust).toMatch(
      /"Principal":\{"Federated":\{"Ref":"GitHubOidcProvider[0-9A-F]+"\}\}/,
    );
  });

  it("grants nothing but assuming this account's CDK bootstrap roles", () => {
    const template = deployAccessTemplate();
    const policy = onlyResource(template, "AWS::IAM::Policy");
    expect(JSON.stringify(policy["Properties"])).toContain('"Action":"sts:AssumeRole"');
    expect(policy["Properties"]).toMatchObject({
      PolicyDocument: {
        Statement: [
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Resource: {
              "Fn::Join": [
                "",
                [
                  "arn:",
                  { Ref: "AWS::Partition" },
                  ":iam::",
                  { Ref: "AWS::AccountId" },
                  ":role/cdk-*",
                ],
              ],
            },
          },
        ],
      },
    });
    const role = onlyResource(template, "AWS::IAM::Role");
    expect(role["Properties"]).not.toHaveProperty("ManagedPolicyArns");
    expect(role["Properties"]).not.toHaveProperty("Policies");
  });

  it("exports the role's ARN as a stack output", () => {
    const outputs = deployAccessTemplate().findOutputs(DEPLOY_ROLE_ARN_OUTPUT);
    expect(Object.keys(outputs)).toStrictEqual([DEPLOY_ROLE_ARN_OUTPUT]);
  });
});

it("adds only exact owned dev writer operations without widening OIDC trust", () => {
  const arn =
    "arn:aws:lambda:ap-northeast-1:123456789012:function:instant-composition-dev-app-ApiFunctionABC123-owned";
  const context = {
    ...infraContext("dev"),
    "storage-writer-arns": JSON.stringify([arn]),
    "storage-writers-paused": true,
  };
  const staged = buildApp(context);
  const access = staged.app.node.findChild("deploy-access");
  if (!(access instanceof DeployAccessStack))
    throw new TypeError("Deploy stack required.");
  const policies = Template.fromStack(access).findResources("AWS::IAM::Policy");
  expect(JSON.stringify(policies)).toContain('"lambda:PutFunctionConcurrency"');
  expect(JSON.stringify(policies)).toContain(arn);
  expect(JSON.stringify(policies)).not.toContain('"lambda:*"');
  expect(
    JSON.stringify(Template.fromStack(access).findResources("AWS::IAM::Role")),
  ).toContain(
    "repo:tomada1114@68495563/instant-composition@1382590627:ref:refs/heads/main",
  );
  const app = staged.app.node.findChild("app");
  if (!(app instanceof AppStack)) throw new TypeError("App stack required.");
  const writers = Template.fromStack(app).findResources("AWS::Lambda::Function");
  const api = Object.entries(writers).find(([id]) => id.startsWith("ApiFunction"))?.[1];
  expect(api).toMatchObject({
    Properties: { Handler: "storage.handler", ReservedConcurrentExecutions: 0 },
    Metadata: { "instant-composition:storage-capacity": "unreserved" },
  });
});

it("permits the read-model worker whose generated name CloudFormation shortened", () => {
  const arns = [
    "arn:aws:lambda:ap-northeast-1:123456789012:function:instant-composition-dev-app-ApiFunctionCE271BD4-T0EgjaNG24sB",
    "arn:aws:lambda:ap-northeast-1:123456789012:function:instant-composition-dev-ap-ReadModelWorker815A8EF5-s6YIrionyg07",
  ];
  const staged = buildApp({
    ...infraContext("dev"),
    "storage-writer-arns": JSON.stringify(arns),
  });
  const access = staged.app.node.findChild("deploy-access");
  if (!(access instanceof DeployAccessStack))
    throw new TypeError("Deploy stack required.");
  const policies = JSON.stringify(
    Template.fromStack(access).findResources("AWS::IAM::Policy"),
  );
  for (const arn of arns) expect(policies).toContain(arn);
});

it.each([
  "*",
  "arn:aws:lambda:ap-northeast-1:123456789012:function:instant-composition-dev-x-ReadModelWorker815A8EF5-s6YIrionyg07",
  "arn:aws:lambda:ap-northeast-1:123456789012:function:instant-composition-prod-app-ReadModelWorker815A8EF5-s6YIrionyg07",
  `arn:aws:lambda:ap-northeast-1:123456789012:function:instant-composition-dev-ap-ReadModelWorker815A8EF5-${"a".repeat(14)}`,
  "arn:aws:lambda:ap-northeast-1:123456789012:function:other",
  "arn:aws:lambda:us-east-1:123456789012:function:instant-composition-dev-app-ApiFunctionABC123-owned",
  "arn:aws:lambda:ap-northeast-1:123456789012:function:instant-composition-dev-app-ApiFunctionABC123-owned:alias",
])("rejects unsafe direct permission subject %s", (arn) => {
  expect(() =>
    buildApp({ ...infraContext("dev"), "storage-writer-arns": JSON.stringify([arn]) }),
  ).toThrow(StorageWriterConfigurationError);
});
