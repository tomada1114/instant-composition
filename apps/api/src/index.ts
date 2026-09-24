// The HTTP API: a Hono app serving packages/contracts' routes over packages/application.
export {
  API_ROOT,
  createApp,
  RouteTableError,
  type ApiApp,
  type ApiDependencies,
  type ApiVariables,
} from "./app";
export type { Authenticator, Identity } from "./authenticator";
export { API_ENV_NAMES, ApiEnvError, readApiEnv, type ApiEnv } from "./env";
export { MAX_REQUEST_BODY_BYTES } from "./http";
export { localAuthenticator, type LocalLearnerOptions } from "./local-authenticator";
export { ensureTable } from "./local-table";
export { jsonLines, type LogLine, type LogSink, type RequestOutcome } from "./log";
export {
  OPERATIONS,
  type BodySchema,
  type Operation,
  type OperationInput,
  type Outcome,
} from "./operations";
