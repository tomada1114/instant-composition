// The HTTP API: a Hono app serving packages/contracts' routes over packages/application.
export type { ApiDependencies } from "./answer";
export {
  API_ROOT,
  createApp,
  RouteTableError,
  type ApiApp,
  type ApiVariables,
} from "./app";
export type { AuthFailure, Authenticator, Principal } from "./authenticator";
export {
  cognitoAuthenticator,
  SESSION_COOKIE,
  type CognitoAuthenticatorOptions,
} from "./cognito-authenticator";
export {
  cognitoWebSession,
  REFRESH_COOKIE,
  SIGN_IN_COOKIE,
  type CognitoWebSessionOptions,
} from "./cognito-web-session";
export { API_ENV_NAMES, HOSTED_ENV_NAMES, readApiEnv, readHostedEnv } from "./env";
export { ApiEnvError } from "./env-values";
export {
  hostedApp,
  hostedHandler,
  type HostedDependencies,
  type HttpApiEvent,
  type HttpApiHandler,
} from "./hosted";
export { DEFAULT_MODEL_ID } from "./env-model";
export type {
  ApiEnv,
  CognitoSettings,
  HostedCognitoSettings,
  HostedEnv,
  HostedModelSettings,
  LocalModelSettings,
  ParametersExtension,
  WebSignInSettings,
} from "./env-settings";
export { MAX_REQUEST_BODY_BYTES } from "./http";
export { LOCAL_SUBJECT, localAuthenticator } from "./local-authenticator";
export {
  LOCAL_SIGN_IN_URLS,
  LOCAL_WEB_ORIGINS,
  localRunAuthenticator,
  localRunWebSession,
  type LocalRunAuthenticator,
} from "./local-run-authenticator";
export { ensureTable } from "./local-table";
export {
  jsonLines,
  type LogLine,
  type LogSink,
  type ModelCallLine,
  type ModelCallOutcome,
  type RequestOutcome,
} from "./log";
export { loggedModel, type ModelCallLog, type ServedModel } from "./model-log";
export {
  OPERATIONS,
  type BodySchema,
  type Operation,
  type OperationDeps,
  type OperationInput,
  type Outcome,
  type PathParam,
  type PathValues,
} from "./operations";
export { readSecureString, SecretParameterError } from "./parameters-extension";
export { hostedModel, localModel, standInTalkModel } from "./served-model";
export {
  TokenEndpointError,
  type CognitoClient,
  type Fetch,
  type IssuedTokens,
} from "./token-endpoint";
export {
  WEB_SESSION_ROUTES,
  type WebSession,
  type WebSessionAnswer,
} from "./web-session";

export { validateStoredRecords, type MaintenanceAnswer } from "./storage-maintenance";
