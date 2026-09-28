import { Duration, type Stack } from "aws-cdk-lib";
import { type HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  type IMetric,
  Metric,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { type IFunction } from "aws-cdk-lib/aws-lambda";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";

import { type Stage } from "./stage";

/**
 * The context key naming the address the alarm topic mails. It is given at
 * deploy time (`-c alarm-email=<address>`) and never committed; without it
 * the topic has no subscription and the alarms still change state.
 */
export const ALARM_EMAIL_CONTEXT = "alarm-email";

/** Every alarm's period: one minute of standard-resolution data. */
const PERIOD = Duration.minutes(1);

export interface ObservabilityProps {
  readonly stage: Stage;
  readonly api: HttpApi;
  readonly handler: IFunction;
  /** The learner table's name, which DynamoDB's metrics are dimensioned by. */
  readonly tableName: string;
  readonly alarmEmail: string | undefined;
}

function tableMetric(tableName: string, metricName: string): Metric {
  return new Metric({
    namespace: "AWS/DynamoDB",
    metricName,
    dimensionsMap: { TableName: tableName },
    statistic: "Sum",
    period: PERIOD,
  });
}

/**
 * ADR-0009's observability baseline, sized to CloudWatch's free tier: five
 * single-metric alarms (the API's 5xx, the function's errors and throttles,
 * the table's read and write throttles) notifying one SNS topic, and one
 * dashboard of traffic, errors and latency.
 */
export function addObservability(
  scope: Stack,
  { stage, api, handler, tableName, alarmEmail }: ObservabilityProps,
): Topic {
  const topic = new Topic(scope, "AlarmTopic", {
    displayName: `instant-composition ${stage} alarms`,
  });
  if (alarmEmail !== undefined) {
    topic.addSubscription(new EmailSubscription(alarmEmail));
  }
  const action = new SnsAction(topic);

  const requests = api.metricCount({ statistic: "Sum", period: PERIOD });
  const serverErrors = api.metricServerError({ statistic: "Sum", period: PERIOD });
  const clientErrors = api.metricClientError({ statistic: "Sum", period: PERIOD });
  const latency = api.metricLatency({ statistic: "p90", period: PERIOD });
  const errors = handler.metricErrors({ statistic: "Sum", period: PERIOD });
  const throttles = handler.metricThrottles({ statistic: "Sum", period: PERIOD });
  const duration = handler.metricDuration({ statistic: "p90", period: PERIOD });
  const readThrottles = tableMetric(tableName, "ReadThrottleEvents");
  const writeThrottles = tableMetric(tableName, "WriteThrottleEvents");

  const alarms: readonly (readonly [string, IMetric, string])[] = [
    ["ApiServerErrorAlarm", serverErrors, "The HTTP API answered a 5xx"],
    ["FunctionErrorAlarm", errors, "The API function threw"],
    ["FunctionThrottleAlarm", throttles, "The API function was throttled"],
    ["TableReadThrottleAlarm", readThrottles, "A learner-table read was throttled"],
    ["TableWriteThrottleAlarm", writeThrottles, "A learner-table write was throttled"],
  ];
  for (const [id, metric, description] of alarms) {
    new Alarm(scope, id, {
      metric,
      alarmDescription: `instant-composition ${stage}: ${description}`,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(action);
  }

  new Dashboard(scope, "Dashboard", {
    dashboardName: `instant-composition-${stage}`,
    widgets: [
      [
        new GraphWidget({ title: "API requests", left: [requests] }),
        new GraphWidget({ title: "API errors", left: [serverErrors, clientErrors] }),
        new GraphWidget({ title: "API latency (p90)", left: [latency] }),
      ],
      [
        new GraphWidget({
          title: "Function errors and throttles",
          left: [errors, throttles],
        }),
        new GraphWidget({ title: "Function duration (p90)", left: [duration] }),
        new GraphWidget({
          title: "Table throttles",
          left: [readThrottles, writeThrottles],
        }),
      ],
    ],
  });
  return topic;
}
