import { runInNewContext } from "node:vm";

import {
  AppStack,
  buildApp,
  DISTRIBUTION_ID_OUTPUT,
  FOUNDATION_PARAMETERS,
  foundationParameterName,
  LAMBDA_CATALOG_PATH,
  PARAMETERS_EXTENSION_LAYER_ARN,
  SPA_BUCKET_NAME_OUTPUT,
  WEB_URL_OUTPUT,
  webClientSecretParameterName,
  type FoundationParameter,
} from "@instant-composition/infra";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { infraContext } from "./infra-context";

function synthesizeApp(): Template {
  const stack = buildApp(infraContext("dev")).app.node.findChild("app");
  if (!(stack instanceof AppStack)) {
    throw new TypeError("the dev app has no app stack");
  }
  return Template.fromStack(stack);
}

// Synthesized once at collection, outside any test's timeout: the first
// synthesis loads aws-cdk-lib and alone takes seconds (#150).
const TEMPLATE = synthesizeApp();

// The managed policies' ids, as CloudFront documents them.
const CACHING_OPTIMIZED = "658327ea-f89d-4fab-a63d-7e88639e58f6";
const CACHING_DISABLED = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
const ALL_VIEWER_EXCEPT_HOST_HEADER = "b689b0a8-53d0-40ab-baf2-68738e2966ac";

function logicalIdOf(type: string): string {
  const [id, ...others] = Object.keys(TEMPLATE.findResources(type));
  if (id === undefined || others.length > 0) {
    throw new TypeError(`the template has no single ${type}`);
  }
  return id;
}

function propertiesOf(type: string): Record<string, unknown> {
  const properties: unknown =
    TEMPLATE.findResources(type)[logicalIdOf(type)]?.["Properties"];
  if (typeof properties !== "object" || properties === null) {
    throw new TypeError(`${type} has no properties`);
  }
  return properties as Record<string, unknown>;
}

/** The CloudFormation parameter the stack resolves a foundation identifier through. */
function foundationReference(parameter: FoundationParameter): { Ref: string } {
  const name = foundationParameterName("dev", parameter);
  const parameters: unknown = TEMPLATE.toJSON()["Parameters"];
  const matches = Object.entries(
    parameters as Record<string, { Type: string; Default?: string }>,
  ).filter(([, definition]) => definition.Default === name);
  expect(matches).toHaveLength(1);
  expect(matches[0]?.[1]).toStrictEqual({
    Type: "AWS::SSM::Parameter::Value<String>",
    Default: name,
  });
  return { Ref: matches[0]?.[0] ?? "" };
}

const DOMAIN_NAME = {
  "Fn::GetAtt": [logicalIdOf("AWS::CloudFront::Distribution"), "DomainName"],
};

/** The dev URL, followed by `path` when one is given. */
function webUrl(path?: string): { "Fn::Join": [string, unknown[]] } {
  return {
    "Fn::Join": [
      "",
      path === undefined ? ["https://", DOMAIN_NAME] : ["https://", DOMAIN_NAME, path],
    ],
  };
}

// ADR-0009's cost guard: nothing billed by the hour whether used or not —
// no NAT gateway, load balancer, interface endpoint or database instance.
describe("the dev app stack's resources", () => {
  it("are only the bucket, the distribution, the HTTP API, the function and their alarms", () => {
    // The CLI adds its own AWS::CDK::Metadata, which bills nothing.
    const types = new Set(
      Object.values(TEMPLATE.toJSON()["Resources"] as Record<string, { Type: string }>)
        .map(({ Type }) => Type)
        .filter((type) => type !== "AWS::CDK::Metadata"),
    );
    expect([...types].sort()).toStrictEqual(
      [
        "AWS::ApiGatewayV2::Api",
        "AWS::ApiGatewayV2::Integration",
        "AWS::ApiGatewayV2::Route",
        "AWS::ApiGatewayV2::Stage",
        "AWS::CloudFront::Distribution",
        "AWS::CloudFront::Function",
        "AWS::CloudFront::OriginAccessControl",
        "AWS::CloudWatch::Alarm",
        "AWS::CloudWatch::Dashboard",
        "AWS::IAM::Policy",
        "AWS::IAM::Role",
        "AWS::Lambda::Function",
        "AWS::Lambda::Permission",
        "AWS::Logs::LogGroup",
        "AWS::S3::Bucket",
        "AWS::S3::BucketPolicy",
        "AWS::SNS::Topic",
      ].sort(),
    );
  });

  // CloudFormation cannot write a SecureString, and a String would put the
  // secret in the template; the parameter is created outside it (#156).
  it("create no parameter, so no secret is in the template", () => {
    expect(TEMPLATE.findResources("AWS::SSM::Parameter")).toStrictEqual({});
  });

  it("read foundation by parameter name, never through a CloudFormation export", () => {
    const template = JSON.stringify(TEMPLATE.toJSON());
    expect(template).not.toContain("Fn::ImportValue");
    expect(template).not.toContain("Fn::GetStackOutput");
  });
});

describe("the dev app stack's SPA bucket", () => {
  it("blocks every kind of public access and is encrypted", () => {
    expect(propertiesOf("AWS::S3::Bucket")).toMatchObject({
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
        ],
      },
    });
  });

  it("lets only this distribution read objects, and only over TLS", () => {
    const bucket = logicalIdOf("AWS::S3::Bucket");
    const distribution = logicalIdOf("AWS::CloudFront::Distribution");
    const policy = propertiesOf("AWS::S3::BucketPolicy");
    expect(policy["Bucket"]).toStrictEqual({ Ref: bucket });
    const statements = (policy["PolicyDocument"] as { Statement: unknown[] }).Statement;
    expect(statements).toHaveLength(2);
    expect(statements).toContainEqual(
      expect.objectContaining({
        Effect: "Deny",
        Principal: { AWS: "*" },
        Condition: { Bool: { "aws:SecureTransport": "false" } },
      }),
    );
    expect(statements).toContainEqual({
      Effect: "Allow",
      Action: "s3:GetObject",
      Principal: { Service: "cloudfront.amazonaws.com" },
      Resource: { "Fn::Join": ["", [{ "Fn::GetAtt": [bucket, "Arn"] }, "/*"]] },
      Condition: {
        StringEquals: {
          "AWS:SourceArn": {
            "Fn::Join": [
              "",
              [
                "arn:",
                { Ref: "AWS::Partition" },
                ":cloudfront::",
                { Ref: "AWS::AccountId" },
                ":distribution/",
                { Ref: distribution },
              ],
            ],
          },
        },
      },
    });
  });
});

describe("the dev app stack's distribution", () => {
  function config(): Record<string, unknown> {
    return propertiesOf("AWS::CloudFront::Distribution")[
      "DistributionConfig"
    ] as Record<string, unknown>;
  }

  it("serves /* from the bucket through origin access control, cached, over https", () => {
    const origins = config()["Origins"] as Record<string, unknown>[];
    const s3 = origins.find((origin) => "S3OriginConfig" in origin);
    expect(s3).toMatchObject({
      DomainName: {
        "Fn::GetAtt": [logicalIdOf("AWS::S3::Bucket"), "RegionalDomainName"],
      },
      OriginAccessControlId: {
        "Fn::GetAtt": [logicalIdOf("AWS::CloudFront::OriginAccessControl"), "Id"],
      },
      S3OriginConfig: { OriginAccessIdentity: "" },
    });
    expect(config()).toMatchObject({
      DefaultRootObject: "index.html",
      DefaultCacheBehavior: {
        TargetOriginId: s3?.["Id"],
        CachePolicyId: CACHING_OPTIMIZED,
        ViewerProtocolPolicy: "redirect-to-https",
        FunctionAssociations: [
          {
            EventType: "viewer-request",
            FunctionARN: {
              "Fn::GetAtt": [logicalIdOf("AWS::CloudFront::Function"), "FunctionARN"],
            },
          },
        ],
      },
    });
  });

  it("sends /api/* uncached to the HTTP API with every viewer header but Host", () => {
    const origins = config()["Origins"] as Record<string, unknown>[];
    const api = origins.find((origin) => "CustomOriginConfig" in origin);
    expect(api).toMatchObject({
      DomainName: {
        "Fn::Join": [
          "",
          [
            { Ref: logicalIdOf("AWS::ApiGatewayV2::Api") },
            ".execute-api.ap-northeast-1.",
            { Ref: "AWS::URLSuffix" },
          ],
        ],
      },
      CustomOriginConfig: { OriginProtocolPolicy: "https-only" },
    });
    expect(api).not.toHaveProperty("OriginPath");
    expect(config()["CacheBehaviors"]).toStrictEqual([
      {
        PathPattern: "/api/*",
        TargetOriginId: api?.["Id"],
        AllowedMethods: ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"],
        CachePolicyId: CACHING_DISABLED,
        OriginRequestPolicyId: ALL_VIEWER_EXCEPT_HOST_HEADER,
        ViewerProtocolPolicy: "https-only",
        Compress: true,
      },
    ]);
  });

  // The flat-rate plans admit only AWS-managed cache, origin request and
  // response header policies below Business, and no legacy cache settings.
  it("uses only what the flat-rate Free plan admits", () => {
    for (const type of [
      "AWS::CloudFront::CachePolicy",
      "AWS::CloudFront::OriginRequestPolicy",
      "AWS::CloudFront::ResponseHeadersPolicy",
      "AWS::CloudFront::CloudFrontOriginAccessIdentity",
      "AWS::CloudFront::RealtimeLogConfig",
    ]) {
      expect(TEMPLATE.findResources(type)).toStrictEqual({});
    }
    expect(JSON.stringify(config())).not.toContain("ForwardedValues");
  });
});

describe("the dev app stack's SPA fallback", () => {
  const code = propertiesOf("AWS::CloudFront::Function")["FunctionCode"];
  // cloudfront-js-2.0 is plain ECMAScript here: the function reads nothing
  // but its event, so a bare context runs it as CloudFront would.
  type ViewerRequest = (event: { request: { uri: string } }) => { uri: string };
  function isViewerRequest(value: unknown): value is ViewerRequest {
    return typeof value === "function";
  }
  const handler: unknown = runInNewContext(`${String(code)}\nhandler;`);
  function serve(uri: string): string {
    if (!isViewerRequest(handler)) throw new TypeError("the code defines no handler");
    return handler({ request: { uri } }).uri;
  }

  it("runs on the cloudfront-js-2.0 runtime", () => {
    expect(propertiesOf("AWS::CloudFront::Function")).toMatchObject({
      AutoPublish: true,
      FunctionConfig: { Runtime: "cloudfront-js-2.0" },
    });
  });

  it.each([
    ["/", "/index.html"],
    ["/drill", "/index.html"],
    ["/records/2026-09", "/index.html"],
    ["/settings/", "/index.html"],
    ["/index.html", "/index.html"],
    ["/assets/index-3f2a.js", "/assets/index-3f2a.js"],
    ["/favicon.svg", "/favicon.svg"],
  ])("serves %s as %s", (uri, served) => {
    expect(serve(uri)).toBe(served);
  });
});

describe("the dev app stack's HTTP API", () => {
  it("serves every method and path on the $default stage, deployed automatically", () => {
    const api = logicalIdOf("AWS::ApiGatewayV2::Api");
    expect(propertiesOf("AWS::ApiGatewayV2::Api")).toMatchObject({
      ProtocolType: "HTTP",
    });
    expect(propertiesOf("AWS::ApiGatewayV2::Stage")).toStrictEqual({
      ApiId: { Ref: api },
      StageName: "$default",
      AutoDeploy: true,
    });
    expect(propertiesOf("AWS::ApiGatewayV2::Route")).toStrictEqual({
      ApiId: { Ref: api },
      RouteKey: "ANY /{proxy+}",
      AuthorizationType: "NONE",
      Target: {
        "Fn::Join": [
          "",
          ["integrations/", { Ref: logicalIdOf("AWS::ApiGatewayV2::Integration") }],
        ],
      },
    });
  });

  it("hands each request to the function as a payload format 2.0 proxy event", () => {
    expect(propertiesOf("AWS::ApiGatewayV2::Integration")).toStrictEqual({
      ApiId: { Ref: logicalIdOf("AWS::ApiGatewayV2::Api") },
      IntegrationType: "AWS_PROXY",
      IntegrationUri: {
        "Fn::GetAtt": [logicalIdOf("AWS::Lambda::Function"), "Arn"],
      },
      PayloadFormatVersion: "2.0",
    });
  });
});

describe("the dev app stack's function", () => {
  it("runs nodejs24.x on arm64, outside any VPC, beside the Parameters and Secrets extension", () => {
    const properties = propertiesOf("AWS::Lambda::Function");
    expect(properties).toMatchObject({
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
      Handler: "index.handler",
      Layers: [PARAMETERS_EXTENSION_LAYER_ARN],
    });
    expect(properties).not.toHaveProperty("VpcConfig");
    expect(PARAMETERS_EXTENSION_LAYER_ARN).toMatch(
      /^arn:aws:lambda:ap-northeast-1:\d{12}:layer:AWS-Parameters-and-Secrets-Lambda-Extension-Arm64:\d+$/,
    );
  });

  it("is configured with foundation's identifiers, the bundled catalog and the dev URL", () => {
    const variables = (
      propertiesOf("AWS::Lambda::Function")["Environment"] as {
        Variables: Record<string, unknown>;
      }
    ).Variables;
    expect(variables).toMatchObject({
      API_TABLE_NAME: foundationReference(FOUNDATION_PARAMETERS.learnerTableName),
      API_CATALOG_PATH: LAMBDA_CATALOG_PATH,
      API_COGNITO_USER_POOL_ID: foundationReference(FOUNDATION_PARAMETERS.userPoolId),
      API_COGNITO_CLIENT_ID: foundationReference(FOUNDATION_PARAMETERS.webClientId),
      API_COGNITO_DOMAIN: foundationReference(FOUNDATION_PARAMETERS.signInDomainUrl),
      API_COGNITO_CLIENT_SECRET_PARAMETER:
        "/instant-composition/dev/app/web-client-secret",
      API_WEB_ORIGINS: webUrl(),
      API_WEB_CALLBACK_URL: webUrl("/api/v1/auth/callback"),
      API_WEB_SIGN_OUT_URL: webUrl("/"),
      PARAMETERS_SECRETS_EXTENSION_HTTP_PORT: "2773",
    });
    expect(webClientSecretParameterName("dev")).toBe(
      variables["API_COGNITO_CLIENT_SECRET_PARAMETER"],
    );
    // The secret enters through the extension alone; readHostedEnv refuses it.
    expect(variables).not.toHaveProperty("API_COGNITO_CLIENT_SECRET");
  });
});

describe("the dev app stack's function role", () => {
  const secretArn = {
    "Fn::Join": [
      "",
      [
        "arn:",
        { Ref: "AWS::Partition" },
        ":ssm:ap-northeast-1:",
        { Ref: "AWS::AccountId" },
        ":parameter/instant-composition/dev/app/web-client-secret",
      ],
    ],
  };

  /**
   * Every action the policy allows, one entry per action and resource, so the
   * assertion holds whether or not `@aws-cdk/aws-iam:minimizePolicies` merged
   * the statements (the CLI sets it from `infra/cdk.json`; a test does not).
   */
  function grants(document: unknown): string[] {
    const { Statement: statements } = document as {
      Statement: {
        Effect: string;
        Action: unknown;
        Resource: unknown;
        Condition?: unknown;
      }[];
    };
    return statements
      .flatMap(
        ({
          Effect: effect,
          Action: action,
          Resource: resource,
          Condition: condition,
        }) =>
          [action].flat().flatMap((one) =>
            [resource].flat().map((on) =>
              JSON.stringify({
                effect,
                action: one,
                on,
                condition: condition ?? null,
              }),
            ),
          ),
      )
      .sort();
  }

  it("may use the learner table, read the secret parameter, and decrypt it through Parameter Store only", () => {
    const policy = propertiesOf("AWS::IAM::Policy");
    expect(policy["Roles"]).toStrictEqual([{ Ref: logicalIdOf("AWS::IAM::Role") }]);
    const table = foundationReference(FOUNDATION_PARAMETERS.learnerTableArn);
    const kms = {
      "Fn::Join": [
        "",
        [
          "arn:",
          { Ref: "AWS::Partition" },
          ":kms:ap-northeast-1:",
          { Ref: "AWS::AccountId" },
          ":key/*",
        ],
      ],
    };
    expect(grants(policy["PolicyDocument"])).toStrictEqual(
      grants({
        Statement: [
          {
            Effect: "Allow",
            Action: [
              "dynamodb:BatchGetItem",
              "dynamodb:BatchWriteItem",
              "dynamodb:ConditionCheckItem",
              "dynamodb:DeleteItem",
              "dynamodb:DescribeTable",
              "dynamodb:GetItem",
              "dynamodb:GetRecords",
              "dynamodb:GetShardIterator",
              "dynamodb:PutItem",
              "dynamodb:Query",
              "dynamodb:Scan",
              "dynamodb:UpdateItem",
            ],
            Resource: table,
          },
          { Effect: "Allow", Action: "ssm:GetParameter", Resource: secretArn },
          {
            Effect: "Allow",
            Action: "kms:Decrypt",
            Resource: kms,
            Condition: {
              StringEquals: {
                "kms:ViaService": {
                  "Fn::Join": ["", ["ssm.ap-northeast-1.", { Ref: "AWS::URLSuffix" }]],
                },
                "kms:EncryptionContext:PARAMETER_ARN": secretArn,
              },
            },
          },
        ],
      }),
    );
  });

  it("is assumed by Lambda alone and otherwise holds only the basic logging policy", () => {
    const role = propertiesOf("AWS::IAM::Role");
    expect(role["AssumeRolePolicyDocument"]).toStrictEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "sts:AssumeRole",
          Principal: { Service: "lambda.amazonaws.com" },
        },
      ],
    });
    expect(role["ManagedPolicyArns"]).toStrictEqual([
      {
        "Fn::Join": [
          "",
          [
            "arn:",
            { Ref: "AWS::Partition" },
            ":iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          ],
        ],
      },
    ]);
    expect(role).not.toHaveProperty("Policies");
  });

  it("lets only this HTTP API invoke the function", () => {
    expect(() =>
      TEMPLATE.hasResourceProperties("AWS::Lambda::Permission", {
        Action: "lambda:InvokeFunction",
        Principal: "apigateway.amazonaws.com",
        FunctionName: { "Fn::GetAtt": [logicalIdOf("AWS::Lambda::Function"), "Arn"] },
        SourceArn: Match.objectLike({
          "Fn::Join": Match.arrayWith([
            Match.arrayWith([{ Ref: logicalIdOf("AWS::ApiGatewayV2::Api") }]),
          ]),
        }),
      }),
    ).not.toThrow();
  });
});

describe("the dev app stack's outputs", () => {
  it("name the dev URL, the SPA bucket and the distribution, with no export", () => {
    expect(TEMPLATE.findOutputs("*")).toStrictEqual({
      [WEB_URL_OUTPUT]: { Value: webUrl() },
      [SPA_BUCKET_NAME_OUTPUT]: { Value: { Ref: logicalIdOf("AWS::S3::Bucket") } },
      [DISTRIBUTION_ID_OUTPUT]: {
        Value: { Ref: logicalIdOf("AWS::CloudFront::Distribution") },
      },
    });
  });
});
