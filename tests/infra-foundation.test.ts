import {
  buildApp,
  FoundationStack,
  LEARNER_TABLE_NAME_OUTPUT,
  SIGN_IN_DOMAIN_URL_OUTPUT,
  type Stage,
  USER_POOL_ID_OUTPUT,
  WEB_CLIENT_ID_OUTPUT,
} from "@instant-composition/infra";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

function foundationTemplate(stage: Stage): Template {
  const stack = buildApp({ stage }).app.node.findChild("foundation");
  if (!(stack instanceof FoundationStack)) {
    throw new TypeError("the app has no foundation stack");
  }
  return Template.fromStack(stack);
}

// ADR-0006's single table, as packages/adapters writes it: `PK` and `SK`
// are its `LEARNER_TABLE_KEY`, which infra/ may not import.
describe("the foundation stack's learner table", () => {
  it.each<Stage>(["dev", "prod"])(
    "is one on-demand table keyed by PK and SK in %s",
    (stage) => {
      const template = foundationTemplate(stage);
      expect(Object.keys(template.findResources("AWS::DynamoDB::Table"))).toHaveLength(
        1,
      );
      expect(() =>
        template.hasResourceProperties("AWS::DynamoDB::Table", {
          KeySchema: [
            { AttributeName: "PK", KeyType: "HASH" },
            { AttributeName: "SK", KeyType: "RANGE" },
          ],
          AttributeDefinitions: [
            { AttributeName: "PK", AttributeType: "S" },
            { AttributeName: "SK", AttributeType: "S" },
          ],
          BillingMode: "PAY_PER_REQUEST",
        }),
      ).not.toThrow();
    },
  );

  it.each<Stage>(["dev", "prod"])(
    "is retained on delete and on replacement in %s",
    (stage) => {
      const template = foundationTemplate(stage);
      expect(() =>
        template.hasResource("AWS::DynamoDB::Table", {
          DeletionPolicy: "Retain",
          UpdateReplacePolicy: "Retain",
        }),
      ).not.toThrow();
    },
  );

  it.each<[Stage, boolean]>([
    ["dev", false],
    ["prod", true],
  ])(
    "has point-in-time recovery and deletion protection in %s: %s",
    (stage, isProtected) => {
      const table = Object.values(
        foundationTemplate(stage).findResources("AWS::DynamoDB::Table"),
      )[0];
      const properties: unknown = table?.["Properties"];
      expect(properties).toMatchObject({
        DeletionProtectionEnabled: isProtected,
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: isProtected },
      });
    },
  );

  it("exports the table's name as a stack output", () => {
    const outputs = foundationTemplate("dev").findOutputs(LEARNER_TABLE_NAME_OUTPUT);
    expect(Object.keys(outputs)).toStrictEqual([LEARNER_TABLE_NAME_OUTPUT]);
    expect(JSON.stringify(outputs[LEARNER_TABLE_NAME_OUTPUT])).toMatch(
      /"Value":\{"Ref":"LearnerTable[0-9A-F]+"\}/,
    );
    expect(outputs[LEARNER_TABLE_NAME_OUTPUT]).not.toHaveProperty("Export");
  });
});

// ADR-0005's user pool, with the stage differences ADR-0009's Stages table
// names: self sign-up off and Cognito's own sender in `dev`.
describe("the foundation stack's user pool", () => {
  it.each<Stage>(["dev", "prod"])(
    "is one Essentials pool signed in to by email in %s",
    (stage) => {
      const template = foundationTemplate(stage);
      expect(
        Object.keys(template.findResources("AWS::Cognito::UserPool")),
      ).toHaveLength(1);
      expect(() =>
        template.hasResourceProperties("AWS::Cognito::UserPool", {
          UserPoolTier: "ESSENTIALS",
          UsernameAttributes: ["email"],
          UsernameConfiguration: { CaseSensitive: false },
          AutoVerifiedAttributes: ["email"],
          MfaConfiguration: "OFF",
        }),
      ).not.toThrow();
    },
  );

  it.each<[Stage, boolean]>([
    ["dev", true],
    ["prod", false],
  ])("lets only an administrator create users in %s: %s", (stage, adminOnly) => {
    expect(() =>
      foundationTemplate(stage).hasResourceProperties("AWS::Cognito::UserPool", {
        AdminCreateUserConfig: { AllowAdminCreateUserOnly: adminOnly },
      }),
    ).not.toThrow();
  });

  it("sends its email through Cognito's own sender in dev", () => {
    expect(() =>
      foundationTemplate("dev").hasResourceProperties("AWS::Cognito::UserPool", {
        EmailConfiguration: { EmailSendingAccount: "COGNITO_DEFAULT" },
      }),
    ).not.toThrow();
  });

  it.each<Stage>(["dev", "prod"])(
    "is retained on delete and on replacement, and protected from deletion, in %s",
    (stage) => {
      expect(() =>
        foundationTemplate(stage).hasResource("AWS::Cognito::UserPool", {
          DeletionPolicy: "Retain",
          UpdateReplacePolicy: "Retain",
          Properties: { DeletionProtection: "ACTIVE" },
        }),
      ).not.toThrow();
    },
  );
});

function logicalIdOf(template: Template, type: string): string {
  const [id, ...others] = Object.keys(template.findResources(type));
  if (id === undefined || others.length > 0) {
    throw new TypeError(`the template has no single ${type}`);
  }
  return id;
}

// ADR-0005's web sign-in: a confidential client the API's `/v1/auth/*`
// endpoints use, and a domain serving managed login, in `dev` only.
describe("the foundation stack's web sign-in", () => {
  it("has one confidential web client limited to the code grant and openid in dev", () => {
    const template = foundationTemplate("dev");
    const pool = logicalIdOf(template, "AWS::Cognito::UserPool");
    expect(
      Object.keys(template.findResources("AWS::Cognito::UserPoolClient")),
    ).toHaveLength(1);
    expect(() =>
      template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
        UserPoolId: { Ref: pool },
        GenerateSecret: true,
        AllowedOAuthFlowsUserPoolClient: true,
        AllowedOAuthFlows: ["code"],
        AllowedOAuthScopes: ["openid"],
        SupportedIdentityProviders: ["COGNITO"],
        CallbackURLs: ["http://127.0.0.1:5173/api/v1/auth/callback"],
        LogoutURLs: ["http://127.0.0.1:5173/"],
        PreventUserExistenceErrors: "ENABLED",
        EnableTokenRevocation: true,
      }),
    ).not.toThrow();
  });

  it("rotates refresh tokens and allows no direct sign-in flow in dev", () => {
    expect(() =>
      foundationTemplate("dev").hasResourceProperties("AWS::Cognito::UserPoolClient", {
        RefreshTokenRotation: { Feature: "ENABLED" },
        // Empty rather than absent: an absent list gets Cognito's default,
        // which includes ALLOW_REFRESH_TOKEN_AUTH.
        ExplicitAuthFlows: Match.exact([]),
      }),
    ).not.toThrow();
  });

  // A prefix is unique across the region's accounts, so it carries the first
  // group of the stack's own generated id: stable, collision-free, not secret.
  it("serves managed login from a prefix domain unique to the stack in dev", () => {
    const template = foundationTemplate("dev");
    expect(
      Object.keys(template.findResources("AWS::Cognito::UserPoolDomain")),
    ).toHaveLength(1);
    expect(() =>
      template.hasResourceProperties("AWS::Cognito::UserPoolDomain", {
        UserPoolId: { Ref: logicalIdOf(template, "AWS::Cognito::UserPool") },
        ManagedLoginVersion: 2,
        Domain: {
          "Fn::Join": [
            "",
            [
              "instant-composition-dev-",
              {
                "Fn::Select": [
                  0,
                  {
                    "Fn::Split": [
                      "-",
                      {
                        "Fn::Select": [
                          2,
                          { "Fn::Split": ["/", { Ref: "AWS::StackId" }] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          ],
        },
      }),
    ).not.toThrow();
  });

  it("gives the web client Cognito's own managed login style in dev", () => {
    const template = foundationTemplate("dev");
    expect(() =>
      template.hasResourceProperties("AWS::Cognito::ManagedLoginBranding", {
        UserPoolId: { Ref: logicalIdOf(template, "AWS::Cognito::UserPool") },
        ClientId: { Ref: logicalIdOf(template, "AWS::Cognito::UserPoolClient") },
        UseCognitoProvidedValues: true,
      }),
    ).not.toThrow();
  });

  it.each([
    "AWS::Cognito::UserPoolClient",
    "AWS::Cognito::UserPoolDomain",
    "AWS::Cognito::ManagedLoginBranding",
  ])("has no %s in prod until prod has a URL", (type) => {
    expect(Object.keys(foundationTemplate("prod").findResources(type))).toHaveLength(0);
  });
});

// A local run reads these from `aws cloudformation describe-stacks` rather
// than from this repository (ADR-0005, Follow-ups).
describe("the foundation stack's sign-in outputs", () => {
  it.each<Stage>(["dev", "prod"])("exports the user pool's id in %s", (stage) => {
    const template = foundationTemplate(stage);
    const outputs = template.findOutputs(USER_POOL_ID_OUTPUT);
    expect(outputs[USER_POOL_ID_OUTPUT]).toStrictEqual({
      Value: { Ref: logicalIdOf(template, "AWS::Cognito::UserPool") },
    });
  });

  it("exports the web client's id and the sign-in domain's URL in dev", () => {
    const template = foundationTemplate("dev");
    const outputs = template.findOutputs("*");
    expect(outputs[WEB_CLIENT_ID_OUTPUT]).toStrictEqual({
      Value: { Ref: logicalIdOf(template, "AWS::Cognito::UserPoolClient") },
    });
    expect(outputs[SIGN_IN_DOMAIN_URL_OUTPUT]).toStrictEqual({
      Value: {
        "Fn::Join": [
          "",
          [
            "https://",
            { Ref: logicalIdOf(template, "AWS::Cognito::UserPoolDomain") },
            ".auth.ap-northeast-1.amazoncognito.com",
          ],
        ],
      },
    });
  });

  it.each<Stage>(["dev", "prod"])(
    "exports no client secret, and nothing through a CloudFormation export, in %s",
    (stage) => {
      const template = foundationTemplate(stage);
      const outputs = template.findOutputs("*");
      expect(Object.keys(outputs).sort()).toStrictEqual(
        (stage === "dev"
          ? [
              LEARNER_TABLE_NAME_OUTPUT,
              SIGN_IN_DOMAIN_URL_OUTPUT,
              USER_POOL_ID_OUTPUT,
              WEB_CLIENT_ID_OUTPUT,
            ]
          : [LEARNER_TABLE_NAME_OUTPUT, USER_POOL_ID_OUTPUT]
        ).sort(),
      );
      expect(JSON.stringify(outputs)).not.toMatch(/ClientSecret|Export/);
      // Reading the secret back needs a custom resource; none exists.
      expect(JSON.stringify(template.toJSON())).not.toContain("Custom::");
    },
  );
});
