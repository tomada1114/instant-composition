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
  API_ENV_NAMES,
  ApiEnvError,
  readApiEnv,
  type ApiEnv,
  type CognitoSettings,
} from "./env";
export { MAX_REQUEST_BODY_BYTES } from "./http";
export { LOCAL_SUBJECT, localAuthenticator } from "./local-authenticator";
export {
  LOCAL_WEB_ORIGINS,
  localRunAuthenticator,
  type LocalRunAuthenticator,
} from "./local-run-authenticator";
export { ensureTable } from "./local-table";
export { jsonLines, type LogLine, type LogSink, type RequestOutcome } from "./log";
export {
  OPERATIONS,
  type BodySchema,
  type Operation,
  type OperationInput,
  type Outcome,
} from "./operations";
