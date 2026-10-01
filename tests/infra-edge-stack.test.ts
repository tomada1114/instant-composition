import { buildApp, EdgeStack, WEB_ACL_ARN_OUTPUT } from "@instant-composition/infra";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { infraContext } from "./infra-context";

function synthesizeEdge(): { stack: EdgeStack; template: Template } {
  const stack = buildApp(infraContext("dev")).app.node.findChild("edge");
  if (!(stack instanceof EdgeStack)) {
    throw new TypeError("the dev app has no edge stack");
  }
  return { stack, template: Template.fromStack(stack) };
}

// Synthesized once at collection, outside any test's timeout: the first
// synthesis loads aws-cdk-lib and alone takes seconds (#150).
const { stack: STACK, template: TEMPLATE } = synthesizeEdge();

function webAcl(): { id: string; properties: Record<string, unknown> } {
  const entries = Object.entries(TEMPLATE.findResources("AWS::WAFv2::WebACL"));
  expect(entries).toHaveLength(1);
  const [entry] = entries;
  if (entry === undefined) throw new TypeError("no web ACL");
  const [id, resource] = entry;
  return { id, properties: resource["Properties"] as Record<string, unknown> };
}

describe("the dev edge stack", () => {
  // A CLOUDFRONT-scope web ACL can be created nowhere else.
  it("deploys to us-east-1", () => {
    expect(STACK.region).toBe("us-east-1");
  });

  it("holds the web ACL alone", () => {
    // The CLI adds its own AWS::CDK::Metadata, which bills nothing.
    const types = Object.values(
      TEMPLATE.toJSON()["Resources"] as Record<string, { Type: string }>,
    )
      .map(({ Type }) => Type)
      .filter((type) => type !== "AWS::CDK::Metadata");
    expect(types).toStrictEqual(["AWS::WAFv2::WebACL"]);
  });

  // ADR-0009 gives dev no WAF rules; the plan needs only the web ACL to exist
  // and stay associated. A rule group of our own is a configuration no
  // flat-rate plan admits.
  it("is a CLOUDFRONT-scope web ACL that allows every request and holds no rule", () => {
    const { properties } = webAcl();
    expect(properties).toMatchObject({
      Scope: "CLOUDFRONT",
      DefaultAction: { Allow: {} },
    });
    expect(properties["Rules"] ?? []).toStrictEqual([]);
    expect(TEMPLATE.findResources("AWS::WAFv2::RuleGroup")).toStrictEqual({});
  });

  // `app` reads the ARN with Fn::GetStackOutput, by this output's name.
  it("publishes the web ACL's ARN as the output app reads", () => {
    const outputs = TEMPLATE.findOutputs(WEB_ACL_ARN_OUTPUT);
    expect(outputs).toStrictEqual({
      [WEB_ACL_ARN_OUTPUT]: { Value: { "Fn::GetAtt": [webAcl().id, "Arn"] } },
    });
  });
});
