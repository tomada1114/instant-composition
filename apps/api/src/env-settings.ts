// The shapes the readers in ./env return: what each entry is configured with.

/** The configuration of a local run of the API; every name has a default or is optional. */
export interface ApiEnv {
  readonly port: number;
  /** DynamoDB local's endpoint; `localDynamoDbClient` refuses one off the loopback. */
  readonly dynamoDbEndpoint: string;
  readonly tableName: string;
  /** The catalog snapshot `pnpm catalog:build` writes, relative to the working directory or absolute. */
  readonly catalogPath: string;
  /** The user pool whose access tokens the API accepts; `null` runs the stand-in authenticator. */
  readonly cognito: CognitoSettings | null;
  /** The model the talk activity calls: OpenRouter with `API_OPENROUTER_API_KEY`, the stand-in without. */
  readonly model: LocalModelSettings;
}

/** A local run's talk model: OpenRouter when a key is set, the scripted stand-in otherwise. */
export type LocalModelSettings =
  | {
      readonly provider: "openrouter";
      /** The OpenRouter model id, such as `anthropic/claude-haiku-4.5`. */
      readonly modelId: string;
      /** A credential: it goes to OpenRouter's endpoint and nowhere else. */
      readonly apiKey: string;
    }
  | { readonly provider: "stand-in" };

/**
 * The Cognito user pool a local run verifies access tokens against, and the
 * confidential web app client and domain it signs a browser in through.
 */
export interface CognitoSettings {
  readonly userPoolId: string;
  readonly clientId: string;
  /** The web app client's secret: it goes to the pool's token endpoint and nowhere else. */
  readonly clientSecret: string;
  /** The user pool domain's origin, e.g. `https://example.auth.ap-northeast-1.amazoncognito.com`. */
  readonly domain: string;
}

/**
 * The configuration of the hosted entry, the Lambda handler in `./lambda`,
 * which `readHostedEnv` reads once when the function starts.
 *
 * @remarks
 * It holds no secret but the function's own session token: the web app
 * client's secret stays in Parameter Store, named by
 * {@link HostedCognitoSettings.clientSecretParameter}, and is read through the
 * AWS Parameters and Secrets Lambda extension when a sign-in endpoint needs it.
 */
export interface HostedEnv {
  /** The Region the learner table is in: the function's own. */
  readonly region: string;
  readonly tableName: string;
  /** The catalog snapshot bundled with the function, relative to its working directory or absolute. */
  readonly catalogPath: string;
  readonly cognito: HostedCognitoSettings;
  readonly web: WebSignInSettings;
  readonly extension: ParametersExtension;
  readonly model: HostedModelSettings;
}

/**
 * The hosted entry's talk model. The key stays in Parameter Store, named by
 * `keyParameter`, and is read through the extension on every call.
 */
export interface HostedModelSettings {
  readonly provider: "openrouter";
  /** The OpenRouter model id, such as `anthropic/claude-haiku-4.5`. */
  readonly modelId: string;
  /** The `SecureString` parameter holding the OpenRouter API key: its name, never its value. */
  readonly keyParameter: string;
}

/** The user pool whose access tokens the hosted API accepts, and the web app client. */
export interface HostedCognitoSettings {
  readonly userPoolId: string;
  readonly clientId: string;
  /** The user pool domain's origin, e.g. `https://example.auth.ap-northeast-1.amazoncognito.com`. */
  readonly domain: string;
  /** The `SecureString` parameter holding the web app client's secret: its name, never its value. */
  readonly clientSecretParameter: string;
}

/** Where the web client is served from, as the web app client registers it. */
export interface WebSignInSettings {
  /** The web client's origins, which the cookie path's `Origin` check admits. */
  readonly origins: readonly string[];
  /** The callback URL registered on the app client, as the browser reaches `/v1/auth/callback`. */
  readonly callbackUrl: string;
  /** The sign-out URL registered on the app client, where the browser lands after `/logout`. */
  readonly signOutUrl: string;
}

/** How the function reaches the AWS Parameters and Secrets Lambda extension beside it. */
export interface ParametersExtension {
  /** The extension's port on localhost, 2773 unless `PARAMETERS_SECRETS_EXTENSION_HTTP_PORT` moves it. */
  readonly port: number;
  /**
   * The function's session token, which the extension requires as
   * `X-Aws-Parameters-Secrets-Token`. A credential: it goes to the extension
   * and nowhere else.
   */
  readonly sessionToken: string;
}
