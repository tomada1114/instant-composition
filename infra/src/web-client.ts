import { Duration } from "aws-cdk-lib";
import {
  CfnManagedLoginBranding,
  OAuthScope,
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
  type UserPoolClientOptions,
} from "aws-cdk-lib/aws-cognito";
import { type Construct, type IDependable } from "constructs";

import { writeClientSecret } from "./web-client-secret";

/** Where Cognito sends the browser back to, after sign-in and after sign-out. */
export interface WebClientUrls {
  readonly callbackUrl: string;
  readonly signOutUrl: string;
}

/**
 * A confidential web app client's settings, the same for
 * foundation's local client and the `app` stack's hosted one: only the URLs
 * Cognito redirects to differ.
 */
export function webClientOptions(urls: WebClientUrls): UserPoolClientOptions {
  return {
    generateSecret: true,
    // Every flow named, so the list is exactly ALLOW_USER_PASSWORD_AUTH
    // rather than absent: an absent one gets Cognito's default,
    // ALLOW_REFRESH_TOKEN_AUTH included, which refresh-token rotation cannot
    // run with. The API signs the web client's own sign-in page in through
    // InitiateAuth's USER_PASSWORD_AUTH with a SECRET_HASH. The code grant
    // below stays as it was: the domain's token and revoke endpoints still
    // renew and end every session.
    authFlows: {
      user: false,
      userSrp: false,
      userPassword: true,
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
  };
}

/** The hosted web app client's pool, URL and secret parameter; every value may be a deploy-time token. */
export interface HostedWebClientProps {
  /** Foundation's user pool, by id and ARN. */
  readonly userPoolId: string;
  readonly userPoolArn: string;
  /** The https URL the client serves, with no trailing slash. */
  readonly webUrl: string;
  /** The `SecureString` parameter the client's secret is written to: its name only. */
  readonly secretParameterName: string;
}

/** The hosted web app client, and what a reader of its secret waits on. */
export interface HostedWebClient {
  readonly clientId: string;
  /** Complete once the client's current secret is in Parameter Store. */
  readonly secretWritten: IDependable;
}

/**
 * The `dev` URL's own web app client, on foundation's user pool, with the
 * managed login style it needs to show a page, and its secret copied into
 * Parameter Store. The client lives here rather than in `foundation`, which
 * never depends on this stack's distribution.
 */
export function addHostedWebClient(
  scope: Construct,
  props: HostedWebClientProps,
): HostedWebClient {
  const { userPoolId, webUrl } = props;
  const client = new UserPoolClient(scope, "WebClient", {
    userPool: UserPool.fromUserPoolId(scope, "UserPool", userPoolId),
    ...webClientOptions({
      callbackUrl: `${webUrl}/api/v1/auth/callback`,
      signOutUrl: `${webUrl}/`,
    }),
  });
  // Managed login shows no page for a client without a style, and only the
  // console assigns one on its own. The pool's domain is foundation's.
  new CfnManagedLoginBranding(scope, "WebClientBranding", {
    userPoolId,
    clientId: client.userPoolClientId,
    useCognitoProvidedValues: true,
  });
  const secretWritten = writeClientSecret(scope, {
    userPoolId,
    userPoolArn: props.userPoolArn,
    clientId: client.userPoolClientId,
    parameterName: props.secretParameterName,
  });
  return { clientId: client.userPoolClientId, secretWritten };
}
