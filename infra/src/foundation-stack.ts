import {
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import {
  AccountRecovery,
  CfnManagedLoginBranding,
  FeaturePlan,
  ManagedLoginVersion,
  Mfa,
  OAuthScope,
  UserPool,
  UserPoolClientIdentityProvider,
  UserPoolEmail,
} from "aws-cdk-lib/aws-cognito";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { ParameterTier, StringParameter } from "aws-cdk-lib/aws-ssm";
import { type Construct } from "constructs";

import {
  FOUNDATION_PARAMETERS,
  type FoundationParameter,
  foundationParameterName,
} from "./foundation-parameters";
import { type Stage } from "./stage";

/**
 * Whether the learner table is protected by point-in-time recovery and
 * deletion protection. `dev` goes without both until `prod` exists
 * (ADR-0009, Stages).
 */
const TABLE_PROTECTED: Readonly<Record<Stage, boolean>> = {
  dev: false,
  prod: true,
};

/**
 * Whether a learner may sign themselves up. In `dev` only an administrator
 * creates users (`AllowAdminCreateUserOnly`, ADR-0009, Stages).
 */
const SELF_SIGN_UP: Readonly<Record<Stage, boolean>> = {
  dev: false,
  prod: true,
};

/** Where Cognito sends the browser back to, after sign-in and after sign-out. */
interface WebClientUrls {
  readonly callbackUrl: string;
  readonly signOutUrl: string;
}

/**
 * The web app client's redirect URLs, or `undefined` where the stage has no
 * web client: `dev`'s serve a local checkout (Cognito allows http only for
 * localhost addresses), and `prod` gets a client once it has a URL.
 */
const WEB_CLIENT: Readonly<Record<Stage, WebClientUrls | undefined>> = {
  dev: {
    callbackUrl: "http://127.0.0.1:5173/api/v1/auth/callback",
    signOutUrl: "http://127.0.0.1:5173/",
  },
  prod: undefined,
};

/** The stack output a later stack, or a local run, reads the table's name from. */
export const LEARNER_TABLE_NAME_OUTPUT = "LearnerTableName";

/** The stack output a local run reads the user pool's id from. */
export const USER_POOL_ID_OUTPUT = "UserPoolId";

/** The stack output a local run reads the web app client's id from. */
export const WEB_CLIENT_ID_OUTPUT = "WebClientId";

/** The stack output a local run reads the sign-in domain's base URL from. */
export const SIGN_IN_DOMAIN_URL_OUTPUT = "SignInDomainUrl";

export interface FoundationStackProps extends StackProps {
  readonly stage: Stage;
}

/**
 * The stateful resources, rarely changed and retained on delete (ADR-0009):
 * the learner table ADR-0006 lays out, and the Cognito user pool ADR-0005
 * signs learners in against.
 */
export class FoundationStack extends Stack {
  constructor(scope: Construct, id: string, { stage, ...props }: FoundationStackProps) {
    super(scope, id, props);
    const isProtected = TABLE_PROTECTED[stage];
    // The key names are packages/adapters' `LEARNER_TABLE_KEY`, which this
    // package may not import; tests/infra-foundation.test.ts holds them equal.
    const table = new Table(this, "LearnerTable", {
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "SK", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      // `Retain` on delete and on replacement in every stage: the owner's own
      // learning history accumulates in `dev` too.
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProtected },
      deletionProtection: isProtected,
    });
    new CfnOutput(this, LEARNER_TABLE_NAME_OUTPUT, { value: table.tableName });
    this.publish(stage, FOUNDATION_PARAMETERS.learnerTableName, table.tableName);
    this.publish(stage, FOUNDATION_PARAMETERS.learnerTableArn, table.tableArn);

    // The sign-in and username settings cannot change once the pool exists: a
    // changed one replaces the pool, and every learner's `sub` with it.
    const userPool = new UserPool(this, "UserPool", {
      featurePlan: FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: SELF_SIGN_UP[stage],
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      mfa: Mfa.OFF,
      // `prod` moves to SES with the production-guard phase (ADR-0009, Email),
      // once a verified sending identity exists; until then no stage has one.
      email: UserPoolEmail.withCognito(),
      removalPolicy: RemovalPolicy.RETAIN,
      deletionProtection: true,
    });
    new CfnOutput(this, USER_POOL_ID_OUTPUT, { value: userPool.userPoolId });
    this.publish(stage, FOUNDATION_PARAMETERS.userPoolId, userPool.userPoolId);
    this.publish(stage, FOUNDATION_PARAMETERS.userPoolArn, userPool.userPoolArn);

    const webClient = WEB_CLIENT[stage];
    if (webClient !== undefined) this.addWebSignIn(userPool, stage, webClient);
  }

  /**
   * The confidential app client the API's `/v1/auth/*` endpoints sign the
   * browser in with (ADR-0005, Web), and the domain serving managed login.
   */
  private addWebSignIn(userPool: UserPool, stage: Stage, urls: WebClientUrls): void {
    const client = userPool.addClient("WebClient", {
      generateSecret: true,
      // Every direct flow named false, so the list is empty rather than
      // absent: an absent one gets Cognito's default, ALLOW_REFRESH_TOKEN_AUTH
      // included, which refresh-token rotation cannot run with (ADR-0005,
      // Refresh). The browser signs in through managed login alone.
      authFlows: {
        user: false,
        userSrp: false,
        userPassword: false,
        adminUserPassword: false,
        custom: false,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID],
        callbackUrls: [urls.callbackUrl],
        logoutUrls: [urls.signOutUrl],
      },
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      refreshTokenRotationGracePeriod: Duration.seconds(10),
      enableTokenRevocation: true,
      preventUserExistenceErrors: true,
    });

    // A prefix is unique across every account in the region, so it carries
    // the first group of this stack's own generated id: stable for the
    // stack's life, clear of anybody else's, and not secret.
    const stackUuid = Fn.select(2, Fn.split("/", this.stackId));
    const domain = userPool.addDomain("SignInDomain", {
      cognitoDomain: {
        domainPrefix: `instant-composition-${stage}-${Fn.select(0, Fn.split("-", stackUuid))}`,
      },
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    // Managed login shows no page for a client without a style, and only the
    // console assigns one on its own.
    const branding = new CfnManagedLoginBranding(this, "WebClientBranding", {
      userPoolId: userPool.userPoolId,
      clientId: client.userPoolClientId,
      useCognitoProvidedValues: true,
    });
    branding.node.addDependency(domain);

    // The client secret is never an output: the API reads it from the
    // secret store at startup (ADR-0009, Configuration and secrets).
    new CfnOutput(this, WEB_CLIENT_ID_OUTPUT, { value: client.userPoolClientId });
    new CfnOutput(this, SIGN_IN_DOMAIN_URL_OUTPUT, { value: domain.baseUrl() });
    this.publish(stage, FOUNDATION_PARAMETERS.webClientId, client.userPoolClientId);
    this.publish(stage, FOUNDATION_PARAMETERS.signInDomainUrl, domain.baseUrl());
  }

  /** One standard-tier (free) String parameter under the stage's prefix. */
  private publish(stage: Stage, parameter: FoundationParameter, value: string): void {
    new StringParameter(this, `Parameter-${parameter}`, {
      parameterName: foundationParameterName(stage, parameter),
      stringValue: value,
      tier: ParameterTier.STANDARD,
    });
  }
}
