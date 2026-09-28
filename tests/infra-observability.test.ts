import {
  ALARM_EMAIL_CONTEXT,
  AppStack,
  buildApp,
  FOUNDATION_PARAMETERS,
  foundationParameterName,
} from "@instant-composition/infra";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { infraContext } from "./infra-context";

function synthesizeApp(context: Record<string, unknown>): Template {
  const stack = buildApp(context).app.node.findChild("app");
  if (!(stack instanceof AppStack)) {
    throw new TypeError("the dev app has no app stack");
  }
  return Template.fromStack(stack);
}

// Synthesized once at collection, outside any test's timeout (#150).
const TEMPLATE = synthesizeApp(infraContext("dev"));
const WITH_EMAIL = synthesizeApp({
  ...infraContext("dev"),
  [ALARM_EMAIL_CONTEXT]: "alarms@example.com",
});

function singleId(type: string): string {
  const ids = Object.keys(TEMPLATE.findResources(type));
  if (ids.length !== 1 || ids[0] === undefined) {
    throw new TypeError(`the template has no single ${type}`);
  }
  return ids[0];
}

function tableNameReference(): { Ref: string } {
  const name = foundationParameterName("dev", FOUNDATION_PARAMETERS.learnerTableName);
  const parameters = TEMPLATE.toJSON()["Parameters"] as Record<
    string,
    { Default?: string }
  >;
  const id = Object.keys(parameters).find((key) => parameters[key]?.Default === name);
  if (id === undefined) {
    throw new TypeError("the template does not resolve the learner table's name");
  }
  return { Ref: id };
}

const ONE_MINUTE_AT_LEAST_ONE = {
  Period: 60,
  Statistic: "Sum",
  Threshold: 1,
  EvaluationPeriods: 1,
  ComparisonOperator: "GreaterThanOrEqualToThreshold",
  TreatMissingData: "notBreaching",
  AlarmActions: [{ Ref: singleId("AWS::SNS::Topic") }],
};

describe("the app stack's observability baseline", () => {
  it("stays within CloudWatch's free tier: five single-metric alarms and one dashboard", () => {
    const alarms = Object.values(TEMPLATE.findResources("AWS::CloudWatch::Alarm"));
    expect(alarms).toHaveLength(5);
    for (const alarm of alarms) {
      expect(alarm["Properties"]).not.toHaveProperty("Metrics");
    }
    TEMPLATE.resourceCountIs("AWS::CloudWatch::Dashboard", 1);
  });

  it("alarms on a single 5xx from the HTTP API", () => {
    expect(() =>
      TEMPLATE.hasResourceProperties("AWS::CloudWatch::Alarm", {
        ...ONE_MINUTE_AT_LEAST_ONE,
        Namespace: "AWS/ApiGateway",
        MetricName: "5xx",
        Dimensions: [
          { Name: "ApiId", Value: { Ref: singleId("AWS::ApiGatewayV2::Api") } },
        ],
      }),
    ).not.toThrow();
  });

  it.each(["Errors", "Throttles"])("alarms on the API function's %s", (metricName) => {
    expect(() =>
      TEMPLATE.hasResourceProperties("AWS::CloudWatch::Alarm", {
        ...ONE_MINUTE_AT_LEAST_ONE,
        Namespace: "AWS/Lambda",
        MetricName: metricName,
        Dimensions: [
          {
            Name: "FunctionName",
            Value: { Ref: Match.stringLikeRegexp("^ApiFunction") },
          },
        ],
      }),
    ).not.toThrow();
  });

  it.each(["ReadThrottleEvents", "WriteThrottleEvents"])(
    "alarms on the learner table's %s, by its name from Parameter Store",
    (metricName) => {
      expect(() =>
        TEMPLATE.hasResourceProperties("AWS::CloudWatch::Alarm", {
          ...ONE_MINUTE_AT_LEAST_ONE,
          Namespace: "AWS/DynamoDB",
          MetricName: metricName,
          Dimensions: [{ Name: "TableName", Value: tableNameReference() }],
        }),
      ).not.toThrow();
    },
  );

  it("draws traffic, errors and latency on one dashboard", () => {
    const body = JSON.stringify(
      TEMPLATE.findResources("AWS::CloudWatch::Dashboard")[
        singleId("AWS::CloudWatch::Dashboard")
      ]?.["Properties"],
    );
    for (const metric of [
      "Count",
      "5xx",
      "4xx",
      "Latency",
      "Errors",
      "Throttles",
      "Duration",
    ]) {
      expect(body).toContain(`\\"${metric}\\"`);
    }
  });

  it("subscribes no address unless one is given as context", () => {
    expect(TEMPLATE.findResources("AWS::SNS::Subscription")).toStrictEqual({});
    expect(() =>
      WITH_EMAIL.hasResourceProperties("AWS::SNS::Subscription", {
        Protocol: "email",
        Endpoint: "alarms@example.com",
      }),
    ).not.toThrow();
  });
});
