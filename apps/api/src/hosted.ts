import { handle, type APIGatewayProxyResult, type LambdaEvent } from "hono/aws-lambda";

import type { ApiDependencies } from "./answer";
import { createApp, type ApiApp } from "./app";
import {
  cognitoAuthenticator,
  type CognitoAuthenticatorOptions,
} from "./cognito-authenticator";
import { cognitoWebSession } from "./cognito-web-session";
import { clientSecret } from "./env-values";
import type { HostedEnv } from "./env-settings";
import { readSecureString, SecretParameterError } from "./parameters-extension";
import { hostedModel } from "./served-model";
import type { Fetch } from "./token-endpoint";
import type { WebSession, WebSessionAnswer } from "./web-session";

/**
 * What the hosted app is handed beside its configuration. The authenticator,
 * the web sign-in endpoints and the model are not among them: the hosted app
 * builds Cognito's and the configured provider's from {@link HostedEnv}
 * itself, so nothing can wire a stand-in.
 */
export interface HostedDependencies extends Omit<
  ApiDependencies,
  "authenticator" | "webSession" | "model"
> {
  /** Reaches the user pool's domain, the model provider and the Parameters and Secrets extension. */
  readonly fetch: Fetch;
  /** The pool's key set, when already known; a test's, so no JWKS is fetched. */
  readonly keySet?: CognitoAuthenticatorOptions["keySet"];
}

/** The event API Gateway's HTTP API sends a Lambda integration, payload format 2.0. */
export type HttpApiEvent = Extract<LambdaEvent, { rawPath: string }>;

/** A Lambda handler answering API Gateway HTTP API events; `Set-Cookie` goes in `cookies`. */
export type HttpApiHandler = (event: HttpApiEvent) => Promise<APIGatewayProxyResult>;

/**
 * The web sign-in endpoints over the web app client, its secret read through
 * the Parameters and Secrets extension each time an endpoint is called: the
 * extension caches it, so the function holds no copy of its own.
 */
function hostedWebSession(env: HostedEnv, fetch: Fetch): WebSession {
  async function session(): Promise<WebSession> {
    const secret = clientSecret(
      await readSecureString(env.extension, env.cognito.clientSecretParameter, fetch),
    );
    if (secret === undefined) {
      throw new SecretParameterError(null, "the parameter holds no app client secret");
    }
    return cognitoWebSession({
      clientId: env.cognito.clientId,
      clientSecret: secret,
      domain: env.cognito.domain,
      fetch,
      webOrigins: env.web.origins,
      callbackUrl: env.web.callbackUrl,
      signOutUrl: env.web.signOutUrl,
    });
  }
  const endpoint =
    (operation: keyof WebSession) =>
    async (request: Request): Promise<WebSessionAnswer> =>
      (await session())[operation](request);
  return {
    startSignIn: endpoint("startSignIn"),
    finishSignIn: endpoint("finishSignIn"),
    refreshSession: endpoint("refreshSession"),
    signOut: endpoint("signOut"),
  };
}

/**
 * The API as the hosted entry serves it: Cognito's authenticator, never the
 * stand-in, admitting the web origins {@link HostedEnv} names, the web
 * sign-in endpoints over the web app client, and the configured model, whose
 * key is read only when a talk calls it.
 */
export function hostedApp(env: HostedEnv, deps: HostedDependencies): ApiApp {
  const { fetch, keySet, ...shared } = deps;
  return createApp({
    ...shared,
    authenticator: cognitoAuthenticator({
      userPoolId: env.cognito.userPoolId,
      clientId: env.cognito.clientId,
      webOrigins: env.web.origins,
      ...(keySet === undefined ? {} : { keySet }),
    }),
    webSession: hostedWebSession(env, fetch),
    model: hostedModel(env.model, env.extension, fetch),
  });
}

/**
 * {@link hostedApp} as a Lambda handler behind API Gateway's HTTP API: each
 * event becomes a `Request` for `app.fetch`, and each `Response` the result
 * API Gateway sends back, every `Set-Cookie` in its `cookies`.
 */
export function hostedHandler(
  env: HostedEnv,
  deps: HostedDependencies,
): HttpApiHandler {
  const serve = handle(hostedApp(env, deps));
  return (event) => serve(event);
}
