import { Aws, CustomResource, Duration, Stack } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  Architecture,
  Code,
  Function as LambdaFunction,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { type Construct } from "constructs";

/**
 * The custom resource handler that copies a client's secret into a
 * `SecureString`: inline Python (CloudFormation's `ZipFile`, at most 4096
 * bytes) on the runtime's own boto3, so nothing is bundled.
 *
 * @remarks
 * The secret is read and written inside one invocation, so it never reaches a
 * template, a resource property, a response or a log line. CDK's
 * `AwsCustomResource` cannot do this: its handler logs every event whole, and
 * a second call's parameters would carry the secret. A failure is reported by
 * the error's code alone, since an SDK message may quote a request's values.
 * A Delete removes the parameter only when it is the one this resource wrote.
 */
const HANDLER = `import json
import urllib.request

import boto3

cognito = boto3.client("cognito-idp")
ssm = boto3.client("ssm")


class NoClientSecret(Exception):
    pass


def error_name(error):
    response = getattr(error, "response", None) or {}
    return response.get("Error", {}).get("Code") or type(error).__name__


def write(p):
    found = cognito.describe_user_pool_client(UserPoolId=p["UserPoolId"], ClientId=p["ClientId"])
    secret = found.get("UserPoolClient", {}).get("ClientSecret")
    if not secret:
        raise NoClientSecret()
    ssm.put_parameter(
        Name=p["ParameterName"], Value=secret, Type="SecureString", Tier="Standard", Overwrite=True
    )


def remove(name):
    try:
        ssm.delete_parameter(Name=name)
    except Exception as error:
        if error_name(error) != "ParameterNotFound":
            raise


def handler(event, context):
    p = event["ResourceProperties"]
    kind = event["RequestType"]
    ours = kind != "Delete" or event.get("PhysicalResourceId") == p["ParameterName"]
    status, reason = "SUCCESS", ""
    try:
        if kind != "Delete":
            write(p)
        elif ours:
            remove(p["ParameterName"])
    except Exception as error:
        status, reason = "FAILED", kind + " failed: " + error_name(error)
        print(reason)
    body = json.dumps({
        "Status": status,
        "Reason": reason,
        "PhysicalResourceId": p["ParameterName"] if ours else event["PhysicalResourceId"],
        "StackId": event["StackId"],
        "RequestId": event["RequestId"],
        "LogicalResourceId": event["LogicalResourceId"],
    }).encode()
    answer = urllib.request.Request(
        event["ResponseURL"], data=body, method="PUT", headers={"Content-Type": ""}
    )
    urllib.request.urlopen(answer, timeout=30)
`;

/** Which client's secret to copy, and where; every value may be a deploy-time token. */
export interface ClientSecretProps {
  readonly userPoolId: string;
  readonly userPoolArn: string;
  readonly clientId: string;
  /** The `SecureString` parameter's name. */
  readonly parameterName: string;
}

/**
 * Copies a confidential client's secret into a `SecureString` parameter on
 * every create and update, which CloudFormation cannot write itself
 * (ADR-0009, Configuration and secrets). A replaced client changes
 * `ClientId`, so its new secret is written in the same deploy.
 *
 * @remarks
 * Keep the construct ids stable once deployed: a renamed resource is created
 * anew and the old one deleted after it, and that Delete would remove the
 * parameter the new one had just written.
 */
export function writeClientSecret(
  scope: Construct,
  props: ClientSecretProps,
): CustomResource {
  const writer = new LambdaFunction(scope, "WebClientSecretWriter", {
    code: Code.fromInline(HANDLER),
    handler: "index.handler",
    runtime: Runtime.PYTHON_3_13,
    architecture: Architecture.ARM_64,
    timeout: Duration.minutes(1),
    logGroup: new LogGroup(scope, "WebClientSecretWriterLogs", {
      retention: RetentionDays.ONE_MONTH,
    }),
    description: "Copies the hosted web app client's secret into Parameter Store",
  });

  const { region, account, urlSuffix } = Stack.of(scope);
  const parameterArn = `arn:${Aws.PARTITION}:ssm:${region}:${account}:parameter${props.parameterName}`;
  writer.addToRolePolicy(
    new PolicyStatement({
      actions: ["cognito-idp:DescribeUserPoolClient"],
      resources: [props.userPoolArn],
    }),
  );
  writer.addToRolePolicy(
    new PolicyStatement({
      actions: ["ssm:PutParameter", "ssm:DeleteParameter"],
      resources: [parameterArn],
    }),
  );
  // Whichever key the parameter is encrypted with, only an encryption
  // Parameter Store asks for, of that one parameter.
  writer.addToRolePolicy(
    new PolicyStatement({
      actions: ["kms:Encrypt"],
      resources: [`arn:${Aws.PARTITION}:kms:${region}:${account}:key/*`],
      conditions: {
        StringEquals: {
          "kms:ViaService": `ssm.${region}.${urlSuffix}`,
          "kms:EncryptionContext:PARAMETER_ARN": parameterArn,
        },
      },
    }),
  );

  return new CustomResource(scope, "WebClientSecret", {
    serviceToken: writer.functionArn,
    resourceType: "Custom::WebClientSecret",
    // A handler that never answers holds the deploy this long, not an hour.
    serviceTimeout: Duration.minutes(5),
    properties: {
      UserPoolId: props.userPoolId,
      ClientId: props.clientId,
      ParameterName: props.parameterName,
    },
  });
}
