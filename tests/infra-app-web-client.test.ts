import {
  AppStack,
  buildApp,
  FOUNDATION_PARAMETERS,
  FoundationStack,
  foundationParameterName,
  webClientSecretParameterName,
  type FoundationParameter,
} from "@instant-composition/infra";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { infraContext } from "./infra-context";

function synthesizeDev(): { app: Template; foundation: Template } {
  const { app } = buildApp(infraContext("dev"));
  const hosted = app.node.findChild("app");
  const foundation = app.node.findChild("foundation");
  if (!(hosted instanceof AppStack) || !(foundation instanceof FoundationStack)) {
    throw new TypeError("the dev app has no app or foundation stack");
  }
  return {
    app: Template.fromStack(hosted),
    foundation: Template.fromStack(foundation),
  };
}

// Synthesized once at collection, outside any test's timeout (#150).
const { app: TEMPLATE, foundation: FOUNDATION } = synthesizeDev();

interface Resource {
  Type: string;
  Properties?: Record<string, unknown>;
  DependsOn?: unknown;
}

/** The one resource of `type` in `template` whose logical id starts with `prefix`. */
function resourceOf(
  type: string,
  prefix = "",
  template = TEMPLATE,
): { id: string; resource: Resource } {
  const matches = Object.entries(
    template.findResources(type) as Record<string, Resource>,
  ).filter(([id]) => id.startsWith(prefix));
  const [match, ...others] = matches;
  if (match === undefined || others.length > 0) {
    throw new TypeError(`the template has no single ${type} named ${prefix}…`);
  }
  return { id: match[0], resource: match[1] };
}

function propertiesOf(
  type: string,
  prefix = "",
  template = TEMPLATE,
): Record<string, unknown> {
  return resourceOf(type, prefix, template).resource.Properties ?? {};
}

/** The CloudFormation parameter the stack resolves a foundation identifier through. */
function foundationReference(parameter: FoundationParameter): { Ref: string } {
  const name = foundationParameterName("dev", parameter);
  const parameters = TEMPLATE.toJSON()["Parameters"] as Record<
    string,
    { Default?: string }
  >;
  const [match, ...others] = Object.entries(parameters).filter(
    ([, definition]) => definition.Default === name,
  );
  if (match === undefined || others.length > 0) {
    throw new TypeError(`the template reads ${name} through no single parameter`);
  }
  return { Ref: match[0] };
}

const CLIENT = resourceOf("AWS::Cognito::UserPoolClient").id;
const WRITER = "WebClientSecretWriter";
const DOMAIN_NAME = {
  "Fn::GetAtt": [resourceOf("AWS::CloudFront::Distribution").id, "DomainName"],
};
const SECRET_PARAMETER = webClientSecretParameterName("dev");
const SECRET_PARAMETER_ARN = {
  "Fn::Join": [
    "",
    [
      "arn:",
      { Ref: "AWS::Partition" },
      ":ssm:ap-northeast-1:",
      { Ref: "AWS::AccountId" },
      `:parameter${SECRET_PARAMETER}`,
    ],
  ],
};

describe("the dev URL's web app client", () => {
  it("is created on foundation's user pool, read from Parameter Store", () => {
    expect(propertiesOf("AWS::Cognito::UserPoolClient")["UserPoolId"]).toStrictEqual(
      foundationReference(FOUNDATION_PARAMETERS.userPoolId),
    );
  });

  it("redirects to the distribution's callback and sign-out URLs over https", () => {
    expect(propertiesOf("AWS::Cognito::UserPoolClient")).toMatchObject({
      CallbackURLs: [
        { "Fn::Join": ["", ["https://", DOMAIN_NAME, "/api/v1/auth/callback"]] },
      ],
      LogoutURLs: [{ "Fn::Join": ["", ["https://", DOMAIN_NAME, "/"]] }],
    });
  });

  it("is confidential, limited to the code grant and openid, rotating refresh tokens", () => {
    expect(propertiesOf("AWS::Cognito::UserPoolClient")).toMatchObject({
      GenerateSecret: true,
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthFlows: ["code"],
      AllowedOAuthScopes: ["openid"],
      SupportedIdentityProviders: ["COGNITO"],
      RefreshTokenRotation: { Feature: "ENABLED" },
      EnableTokenRevocation: true,
      PreventUserExistenceErrors: "ENABLED",
    });
    // Empty rather than absent: an absent list gets Cognito's default, which
    // includes ALLOW_REFRESH_TOKEN_AUTH.
    expect(() =>
      TEMPLATE.hasResourceProperties("AWS::Cognito::UserPoolClient", {
        ExplicitAuthFlows: Match.exact([]),
      }),
    ).not.toThrow();
  });

  it("has the local client's settings in everything but its pool and URLs", () => {
    const ownSettings = new Set(["UserPoolId", "CallbackURLs", "LogoutURLs"]);
    const settings = (properties: Record<string, unknown>): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(properties).filter(([key]) => !ownSettings.has(key)),
      );
    expect(settings(propertiesOf("AWS::Cognito::UserPoolClient"))).toStrictEqual(
      settings(propertiesOf("AWS::Cognito::UserPoolClient", "", FOUNDATION)),
    );
  });

  // Managed login shows no page for a client without a style.
  it("has Cognito's managed login style", () => {
    expect(propertiesOf("AWS::Cognito::ManagedLoginBranding")).toStrictEqual({
      UserPoolId: foundationReference(FOUNDATION_PARAMETERS.userPoolId),
      ClientId: { Ref: CLIENT },
      UseCognitoProvidedValues: true,
    });
  });

  it("is the client the API's function signs in with, for the distribution's origin alone", () => {
    const { Variables: variables } = propertiesOf(
      "AWS::Lambda::Function",
      "ApiFunction",
    )["Environment"] as { Variables: Record<string, unknown> };
    expect(variables).toMatchObject({
      API_COGNITO_CLIENT_ID: { Ref: CLIENT },
      API_COGNITO_CLIENT_SECRET_PARAMETER: SECRET_PARAMETER,
      API_WEB_ORIGINS: { "Fn::Join": ["", ["https://", DOMAIN_NAME]] },
    });
  });

  it("never puts its secret in an attribute, a parameter or an output", () => {
    const template = JSON.stringify(TEMPLATE.toJSON());
    expect(template).not.toMatch(/"Fn::GetAtt":\[[^\]]*"ClientSecret"\]/);
    expect(TEMPLATE.findResources("AWS::SSM::Parameter")).toStrictEqual({});
    expect(JSON.stringify(TEMPLATE.findOutputs("*"))).not.toContain(CLIENT);
  });
});

describe("the dev URL's client secret in Parameter Store", () => {
  const { id: secret, resource: secretResource } = resourceOf(
    "Custom::WebClientSecret",
  );

  it("is written by a custom resource told only the pool, the client and the parameter's name", () => {
    expect(secretResource.Properties).toStrictEqual({
      ServiceToken: {
        "Fn::GetAtt": [resourceOf("AWS::Lambda::Function", WRITER).id, "Arn"],
      },
      ServiceTimeout: "300",
      UserPoolId: foundationReference(FOUNDATION_PARAMETERS.userPoolId),
      ClientId: { Ref: CLIENT },
      ParameterName: SECRET_PARAMETER,
    });
  });

  it("is written before the API's function starts with the client", () => {
    const { resource } = resourceOf("AWS::Lambda::Function", "ApiFunction");
    expect(resource.DependsOn).toContain(secret);
  });

  // tests/infra-web-client-secret.test.ts runs the inline code itself.
  it("is written by an inline python3.13 function on arm64, outside any VPC", () => {
    const properties = propertiesOf("AWS::Lambda::Function", WRITER);
    expect(properties).toMatchObject({
      Runtime: "python3.13",
      Architectures: ["arm64"],
      Handler: "index.handler",
      LoggingConfig: {
        LogGroup: { Ref: resourceOf("AWS::Logs::LogGroup", WRITER).id },
      },
    });
    expect(properties).not.toHaveProperty("VpcConfig");
    expect(properties).not.toHaveProperty("Environment");
    expect(propertiesOf("AWS::Logs::LogGroup", WRITER)).toStrictEqual({
      RetentionInDays: 30,
    });
  });

  /**
   * Every action a policy allows, one entry per action and resource, so the
   * assertion holds whether or not `@aws-cdk/aws-iam:minimizePolicies` merged
   * or reordered the statements (the CLI sets it from `infra/cdk.json`; a
   * test does not).
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

  it("is written by a function that may read the one client and write the one parameter", () => {
    const policy = propertiesOf("AWS::IAM::Policy", WRITER);
    expect(policy["Roles"]).toStrictEqual([
      { Ref: resourceOf("AWS::IAM::Role", WRITER).id },
    ]);
    expect(grants(policy["PolicyDocument"])).toStrictEqual(
      grants({
        Statement: [
          {
            Effect: "Allow",
            Action: "cognito-idp:DescribeUserPoolClient",
            Resource: foundationReference(FOUNDATION_PARAMETERS.userPoolArn),
          },
          {
            Effect: "Allow",
            Action: ["ssm:DeleteParameter", "ssm:PutParameter"],
            Resource: SECRET_PARAMETER_ARN,
          },
          {
            Effect: "Allow",
            Action: "kms:Encrypt",
            Resource: {
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
            },
            Condition: {
              StringEquals: {
                "kms:ViaService": {
                  "Fn::Join": ["", ["ssm.ap-northeast-1.", { Ref: "AWS::URLSuffix" }]],
                },
                "kms:EncryptionContext:PARAMETER_ARN": SECRET_PARAMETER_ARN,
              },
            },
          },
        ],
      }),
    );
  });
});
