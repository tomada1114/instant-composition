import { runInNewContext } from "node:vm";

import {
  AppStack,
  buildApp,
  CLOUDFRONT_PLAN_TIER,
  DISTRIBUTION_ID_OUTPUT,
  FOUNDATION_PARAMETERS,
  foundationParameterName,
  LAMBDA_CATALOG_PATH,
  PARAMETERS_EXTENSION_LAYER_ARN,
  SPA_BUCKET_NAME_OUTPUT,
  TALK_MODEL,
  WEB_ACL_ARN_OUTPUT,
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

// The API's function, role, policy and log group, beside the web client
// secret writer's.
const API_FUNCTION = "ApiFunction";

/** The one resource of `type` whose logical id starts with `prefix`. */
function logicalIdOf(type: string, prefix = ""): string {
  const [id, ...others] = Object.keys(TEMPLATE.findResources(type)).filter((key) =>
    key.startsWith(prefix),
  );
  if (id === undefined || others.length > 0) {
    throw new TypeError(`the template has no single ${type} named ${prefix}…`);
  }
  return id;
}

function propertiesOf(type: string, prefix = ""): Record<string, unknown> {
  const properties: unknown =
    TEMPLATE.findResources(type)[logicalIdOf(type, prefix)]?.["Properties"];
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

// The edge stack's web ACL, read across Regions by output name.
const WEB_ACL_ARN = {
  "Fn::GetStackOutput": {
    StackName: "instant-composition-dev-edge",
    Region: "us-east-1",
    OutputName: WEB_ACL_ARN_OUTPUT,
  },
};

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

// The cost guard: nothing billed by the hour whether used or not —
// no NAT gateway, load balancer, interface endpoint or database instance.
describe("the dev app stack's resources", () => {
  it("are only the bucket, the distribution and its plan, the HTTP API, the API and maintenance functions, their schedule and alarms, the web client and the Bedrock budget", () => {
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
        "AWS::Budgets::Budget",
        "AWS::Budgets::BudgetsAction",
        "AWS::CloudFront::Distribution",
        "AWS::CloudFront::Function",
        "AWS::CloudFront::OriginAccessControl",
        "AWS::CloudWatch::Alarm",
        "AWS::CloudWatch::Dashboard",
        "AWS::Cognito::ManagedLoginBranding",
        "AWS::Cognito::UserPoolClient",
        "AWS::Events::Rule",
        "AWS::IAM::ManagedPolicy",
        "AWS::IAM::Policy",
        "AWS::IAM::Role",
        "AWS::Lambda::Function",
        "AWS::Lambda::Permission",
        "AWS::Logs::LogGroup",
        "AWS::PricingPlanManager::Subscription",
        "AWS::S3::Bucket",
        "AWS::S3::BucketPolicy",
        "AWS::SNS::Topic",
        "AWS::SNS::TopicPolicy",
        "Custom::WebClientSecret",
      ].sort(),
    );
  });

  // CloudFormation cannot write a SecureString, and a String would put the
  // secret in the template; the custom resource writes the parameter instead.
  it("create no parameter, so no secret is in the template", () => {
    expect(TEMPLATE.findResources("AWS::SSM::Parameter")).toStrictEqual({});
  });

  // Parameter Store is regional, so the edge stack's web ACL in us-east-1 is
  // the one value read with Fn::GetStackOutput; foundation's never are.
  it("read foundation by parameter name, and only edge's web ACL by stack output, never through an export", () => {
    const template = JSON.stringify(TEMPLATE.toJSON());
    expect(template).not.toContain("Fn::ImportValue");
    const references = template.match(/\{"Fn::GetStackOutput":\{[^}]*\}\}/g) ?? [];
    expect(references.length).toBeGreaterThan(0);
    expect(new Set(references)).toStrictEqual(new Set([JSON.stringify(WEB_ACL_ARN)]));
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
    // The Free plan's cap on cache behaviors, the default one included.
    const behaviors = (config()["CacheBehaviors"] as unknown[] | undefined) ?? [];
    expect(behaviors.length + 1).toBeLessThanOrEqual(5);
  });

  // A plan needs a CLOUDFRONT-scope web ACL associated with the distribution
  // for as long as the subscription lasts.
  it("is associated with the edge stack's web ACL", () => {
    expect(config()["WebACLId"]).toStrictEqual(WEB_ACL_ARN);
  });
});

// dev's distribution is on the flat-rate Free plan (#173).
describe("the dev app stack's pricing plan", () => {
  it("subscribes the distribution and its web ACL to CloudFront's flat-rate Free plan", () => {
    expect(CLOUDFRONT_PLAN_TIER).toBe("FREE");
    expect(propertiesOf("AWS::PricingPlanManager::Subscription")).toStrictEqual({
      PlanFamily: "CloudFront",
      PlanTier: "FREE",
      UsageLevel: "DEFAULT",
      ResourceArns: [
        {
          "Fn::Join": [
            "",
            [
              "arn:",
              { Ref: "AWS::Partition" },
              ":cloudfront::",
              { Ref: "AWS::AccountId" },
              ":distribution/",
              { Ref: logicalIdOf("AWS::CloudFront::Distribution") },
            ],
          ],
        },
        WEB_ACL_ARN,
      ],
    });
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
    const routes = Object.values(
      TEMPLATE.findResources("AWS::ApiGatewayV2::Route") as Record<
        string,
        { Properties: { RouteKey: string } }
      >,
    );
    expect(routes.map(({ Properties: properties }) => properties)).toStrictEqual(
      ["ANY /{proxy+}", "ANY /api/v1/talks", "ANY /api/v1/talks/{proxy+}"].map(
        (routeKey) => ({
          ApiId: { Ref: api },
          RouteKey: routeKey,
          AuthorizationType: "NONE",
          Target: {
            "Fn::Join": [
              "",
              ["integrations/", { Ref: logicalIdOf("AWS::ApiGatewayV2::Integration") }],
            ],
          },
        }),
      ),
    );
  });

  it("throttles the talk routes on the $default stage at 2 requests per second, burst 10", () => {
    const stage = TEMPLATE.findResources("AWS::ApiGatewayV2::Stage");
    const [definition] = Object.values(stage);
    expect(definition?.["Properties"]).toStrictEqual({
      ApiId: { Ref: logicalIdOf("AWS::ApiGatewayV2::Api") },
      StageName: "$default",
      AutoDeploy: true,
      RouteSettings: {
        "ANY /api/v1/talks": { ThrottlingRateLimit: 2, ThrottlingBurstLimit: 10 },
        "ANY /api/v1/talks/{proxy+}": {
          ThrottlingRateLimit: 2,
          ThrottlingBurstLimit: 10,
        },
      },
    });
    // The stage names the routes, so it is created after them.
    const talkRoutes = Object.entries(
      TEMPLATE.findResources("AWS::ApiGatewayV2::Route") as Record<
        string,
        { Properties: { RouteKey: string } }
      >,
    )
      .filter(([, route]) => route.Properties.RouteKey.startsWith("ANY /api/v1/talks"))
      .map(([id]) => id);
    expect(talkRoutes).toHaveLength(2);
    expect(definition?.["DependsOn"]).toStrictEqual(expect.arrayContaining(talkRoutes));
  });

  it("hands each request to the function as a payload format 2.0 proxy event", () => {
    expect(propertiesOf("AWS::ApiGatewayV2::Integration")).toStrictEqual({
      ApiId: { Ref: logicalIdOf("AWS::ApiGatewayV2::Api") },
      IntegrationType: "AWS_PROXY",
      IntegrationUri: {
        "Fn::GetAtt": [logicalIdOf("AWS::Lambda::Function", API_FUNCTION), "Arn"],
      },
      PayloadFormatVersion: "2.0",
    });
  });
});

describe("the dev app stack's function", () => {
  it("runs nodejs24.x on arm64, outside any VPC, beside the Parameters and Secrets extension", () => {
    const properties = propertiesOf("AWS::Lambda::Function", API_FUNCTION);
    expect(properties).toMatchObject({
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
      Handler: "storage.handler",
      Layers: [PARAMETERS_EXTENSION_LAYER_ARN],
    });
    expect(properties).not.toHaveProperty("VpcConfig");
    expect(PARAMETERS_EXTENSION_LAYER_ARN).toMatch(
      /^arn:aws:lambda:ap-northeast-1:\d{12}:layer:AWS-Parameters-and-Secrets-Lambda-Extension-Arm64:\d+$/,
    );
  });

  it("times out after 25 s, under API Gateway's and CloudFront's 30 s", () => {
    expect(propertiesOf("AWS::Lambda::Function", API_FUNCTION)["Timeout"]).toBe(25);
  });

  it("is configured with foundation's identifiers, the dev URL's client, the bundled catalog and the dev URL", () => {
    const variables = (
      propertiesOf("AWS::Lambda::Function", API_FUNCTION)["Environment"] as {
        Variables: Record<string, unknown>;
      }
    ).Variables;
    expect(variables).toMatchObject({
      API_TABLE_NAME: foundationReference(FOUNDATION_PARAMETERS.learnerTableName),
      API_CATALOG_PATH: LAMBDA_CATALOG_PATH,
      API_COGNITO_USER_POOL_ID: foundationReference(FOUNDATION_PARAMETERS.userPoolId),
      API_COGNITO_CLIENT_ID: { Ref: logicalIdOf("AWS::Cognito::UserPoolClient") },
      API_COGNITO_DOMAIN: foundationReference(FOUNDATION_PARAMETERS.signInDomainUrl),
      API_COGNITO_CLIENT_SECRET_PARAMETER:
        "/instant-composition/dev/app/web-client-secret",
      API_WEB_ORIGINS: webUrl(),
      API_WEB_CALLBACK_URL: webUrl("/api/v1/auth/callback"),
      API_WEB_SIGN_OUT_URL: webUrl("/"),
      PARAMETERS_SECRETS_EXTENSION_HTTP_PORT: "2773",
      API_MODEL_PROVIDER: "openrouter",
      API_MODEL_ID: "anthropic/claude-haiku-4.5",
      API_OPENROUTER_KEY_PARAMETER: "/instant-composition/dev/app/openrouter-api-key",
    });
    expect(TALK_MODEL.dev.keyParameter).toBe(variables["API_OPENROUTER_KEY_PARAMETER"]);
    expect(variables).not.toHaveProperty("API_OPENROUTER_API_KEY");
    expect(webClientSecretParameterName("dev")).toBe(
      variables["API_COGNITO_CLIENT_SECRET_PARAMETER"],
    );
    // The secret enters through the extension alone; readHostedEnv refuses it.
    expect(variables).not.toHaveProperty("API_COGNITO_CLIENT_SECRET");
  });
});

describe("the dev app stack's function role", () => {
  function parameterArn(name: string): unknown {
    return {
      "Fn::Join": [
        "",
        [
          "arn:",
          { Ref: "AWS::Partition" },
          ":ssm:ap-northeast-1:",
          { Ref: "AWS::AccountId" },
          `:parameter${name}`,
        ],
      ],
    };
  }
  const secretArn = parameterArn("/instant-composition/dev/app/web-client-secret");
  const keyArn = parameterArn("/instant-composition/dev/app/openrouter-api-key");

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

  it("may use the learner table, read the client secret and the model key parameters, and decrypt each through Parameter Store only", () => {
    const policy = propertiesOf("AWS::IAM::Policy", API_FUNCTION);
    expect(policy["Roles"]).toStrictEqual([
      { Ref: logicalIdOf("AWS::IAM::Role", API_FUNCTION) },
    ]);
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
          ...[secretArn, keyArn].flatMap((arn) => [
            { Effect: "Allow", Action: "ssm:GetParameter", Resource: arn },
            {
              Effect: "Allow",
              Action: "kms:Decrypt",
              Resource: kms,
              Condition: {
                StringEquals: {
                  "kms:ViaService": {
                    "Fn::Join": [
                      "",
                      ["ssm.ap-northeast-1.", { Ref: "AWS::URLSuffix" }],
                    ],
                  },
                  "kms:EncryptionContext:PARAMETER_ARN": arn,
                },
              },
            },
          ]),
        ],
      }),
    );
  });

  it("is assumed by Lambda alone and otherwise holds only the basic logging policy", () => {
    const role = propertiesOf("AWS::IAM::Role", API_FUNCTION);
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
        FunctionName: {
          "Fn::GetAtt": [logicalIdOf("AWS::Lambda::Function", API_FUNCTION), "Arn"],
        },
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

describe("independent read-model maintenance", () => {
  it("schedules a separate bounded worker every minute without reserving concurrency", () => {
    expect(Object.keys(TEMPLATE.findResources("AWS::Events::Rule"))).toHaveLength(1);
    TEMPLATE.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs24.x",
      Timeout: 60,
      Environment: {
        Variables: Match.objectLike({ API_CATALOG_PATH: LAMBDA_CATALOG_PATH }),
      },
    });
    const workers = Object.entries(TEMPLATE.findResources("AWS::Lambda::Function"))
      .filter(([id]) => id.startsWith("ReadModelWorker"))
      .map(([, resource]) => resource);
    expect(workers).toHaveLength(1);
    // An account at Lambda's default quota of ten can reserve no concurrency.
    expect(workers[0]).toMatchObject({
      Metadata: { "instant-composition:storage-capacity": "unreserved" },
    });
    expect(workers[0]?.["Properties"]).not.toHaveProperty(
      "ReservedConcurrentExecutions",
    );
    TEMPLATE.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "rate(1 minute)",
      State: "ENABLED",
      Targets: Match.arrayWith([
        Match.objectLike({
          RetryPolicy: { MaximumEventAgeInSeconds: 300, MaximumRetryAttempts: 2 },
        }),
      ]),
    });
  });
});
