import {
  buildApp,
  DEPLOY_ROLE_ARN_OUTPUT,
  DeployAccessStack,
} from "@instant-composition/infra";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

function deployAccessTemplate(): Template {
  const stack = buildApp({ stage: "dev" }).app.node.findChild("deploy-access");
  if (!(stack instanceof DeployAccessStack)) {
    throw new TypeError("the dev app has no deploy-access stack");
  }
  return Template.fromStack(stack);
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
                  "repo:tomada1114/instant-composition:ref:refs/heads/main",
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
