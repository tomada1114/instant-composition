import {
  ApiEnvError,
  awsRegion,
  blank,
  clientId,
  clientSecret,
  domain,
  envReader,
  httpsOrigins,
  httpsUrl,
  httpUrl,
  parameterName,
  port,
  invalidVariables,
  tableName,
  text,
  userPoolId,
  type Source,
} from "./env-values";
import {
  HOSTED_MODEL_NAMES,
  hostedModelSettings,
  LOCAL_MODEL_NAMES,
  localModelSettings,
} from "./env-model";
import type { ApiEnv, HostedEnv } from "./env-settings";

// The only module in `apps/api` that reads `process.env`, which Node may have
// filled from `.env.local` (`pnpm api`'s `--env-file-if-exists`); no file is read here.

/** The variables naming the user pool: all set, or none. */
const COGNITO_NAMES = [
  "API_COGNITO_USER_POOL_ID",
  "API_COGNITO_CLIENT_ID",
  "API_COGNITO_CLIENT_SECRET",
  "API_COGNITO_DOMAIN",
] as const;

/** Every variable {@link readApiEnv} reads. */
export const API_ENV_NAMES = [
  "API_PORT",
  "API_DYNAMODB_ENDPOINT",
  "API_TABLE_NAME",
  "API_CATALOG_PATH",
  ...COGNITO_NAMES,
  ...LOCAL_MODEL_NAMES,
] as const;

/**
 * Variables AWS sets in every process it runs. The local run is a process on
 * this machine, and with no user pool configured it authenticates nobody, so
 * it refuses to start where any of them is present.
 */
const HOSTED_MARKERS = [
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_EXECUTION_ENV",
  "ECS_CONTAINER_METADATA_URI",
];

/**
 * Reads and validates the local run's environment. A blank value reads as
 * unset, and surrounding whitespace is dropped.
 *
 * The four `API_COGNITO_*` names are set together or not at all: all set wire
 * the Cognito authenticator and the web sign-in endpoints, none the stand-in.
 * `API_OPENROUTER_API_KEY` wires OpenRouter as the talk model, and its absence
 * the stand-in model.
 *
 * @throws {@link ApiEnvError} `ERR_API_ENV_INVALID` naming every variable that
 * holds no value its setting accepts — or that is unset while another
 * `API_COGNITO_*` name is set — or `ERR_API_ENV_NOT_LOCAL` when AWS runs the process.
 */
export function readApiEnv(source: Source = process.env): ApiEnv {
  const hosted = HOSTED_MARKERS.filter((name) => (source[name] ?? "") !== "");
  if (hosted.length > 0) {
    throw new ApiEnvError(
      "ERR_API_ENV_NOT_LOCAL",
      hosted,
      "The local API serves only a process on this machine; it refuses to start where AWS runs it.",
    );
  }
  const reader = envReader(source);
  const { read, invalid } = reader;
  const env: Omit<ApiEnv, "cognito" | "model"> = {
    port: read("API_PORT", port) ?? 8787,
    dynamoDbEndpoint: read("API_DYNAMODB_ENDPOINT", httpUrl) ?? "http://localhost:8000",
    tableName: read("API_TABLE_NAME", tableName) ?? "instant-composition-local",
    catalogPath: read("API_CATALOG_PATH", text) ?? "dist/catalog/en/ja.json",
  };
  const pool = read("API_COGNITO_USER_POOL_ID", userPoolId);
  const client = read("API_COGNITO_CLIENT_ID", clientId);
  const secret = read("API_COGNITO_CLIENT_SECRET", clientSecret);
  const at = read("API_COGNITO_DOMAIN", domain);
  if (COGNITO_NAMES.some((name) => !blank(source, name))) {
    invalid.push(...COGNITO_NAMES.filter((name) => blank(source, name)));
  }
  const model = localModelSettings(reader);
  if (invalid.length > 0) {
    throw invalidVariables(invalid);
  }
  return {
    ...env,
    model,
    cognito:
      pool === undefined ||
      client === undefined ||
      secret === undefined ||
      at === undefined
        ? null
        : { userPoolId: pool, clientId: client, clientSecret: secret, domain: at },
  };
}

/**
 * Every variable {@link readHostedEnv} reads; `API_COGNITO_CLIENT_SECRET` and
 * `API_OPENROUTER_API_KEY` only to refuse them.
 */
export const HOSTED_ENV_NAMES = [
  "AWS_REGION",
  "AWS_SESSION_TOKEN",
  "PARAMETERS_SECRETS_EXTENSION_HTTP_PORT",
  "API_TABLE_NAME",
  "API_CATALOG_PATH",
  "API_COGNITO_USER_POOL_ID",
  "API_COGNITO_CLIENT_ID",
  "API_COGNITO_DOMAIN",
  "API_COGNITO_CLIENT_SECRET_PARAMETER",
  "API_COGNITO_CLIENT_SECRET",
  "API_WEB_ORIGINS",
  "API_WEB_CALLBACK_URL",
  "API_WEB_SIGN_OUT_URL",
  ...HOSTED_MODEL_NAMES,
] as const;

/**
 * Reads and validates the hosted entry's environment, once, when the function
 * starts. Every name is required but the extension's port; the user pool is
 * never optional here, because the hosted entry has no stand-in to fall back
 * to. `API_COGNITO_CLIENT_SECRET` and `API_OPENROUTER_API_KEY` are refused:
 * each secret enters through the Parameters and Secrets extension alone,
 * never as a plain variable.
 *
 * @throws {@link ApiEnvError} `ERR_API_ENV_INVALID` naming every variable that
 * is unset, holds no value its setting accepts, or is the refused one.
 */
export function readHostedEnv(source: Source = process.env): HostedEnv {
  const reader = envReader(source);
  const { read, required, invalid } = reader;
  const region = required("AWS_REGION", awsRegion);
  const sessionToken = required("AWS_SESSION_TOKEN", text);
  const extensionPort = read("PARAMETERS_SECRETS_EXTENSION_HTTP_PORT", port) ?? 2773;
  const table = required("API_TABLE_NAME", tableName);
  const catalogPath = required("API_CATALOG_PATH", text);
  const pool = required("API_COGNITO_USER_POOL_ID", userPoolId);
  const client = required("API_COGNITO_CLIENT_ID", clientId);
  const at = required("API_COGNITO_DOMAIN", domain);
  const secretParameter = required(
    "API_COGNITO_CLIENT_SECRET_PARAMETER",
    parameterName,
  );
  if (!blank(source, "API_COGNITO_CLIENT_SECRET")) {
    invalid.push("API_COGNITO_CLIENT_SECRET");
  }
  const origins = required("API_WEB_ORIGINS", httpsOrigins);
  const callbackUrl = required("API_WEB_CALLBACK_URL", httpsUrl);
  const signOutUrl = required("API_WEB_SIGN_OUT_URL", httpsUrl);
  const model = hostedModelSettings(source, reader);
  if (
    invalid.length > 0 ||
    region === undefined ||
    sessionToken === undefined ||
    table === undefined ||
    catalogPath === undefined ||
    pool === undefined ||
    client === undefined ||
    at === undefined ||
    secretParameter === undefined ||
    origins === undefined ||
    callbackUrl === undefined ||
    signOutUrl === undefined ||
    model === undefined
  ) {
    // `required` has named each of these that is undefined, so `invalid` is never empty here.
    throw invalidVariables(invalid);
  }
  return {
    region,
    tableName: table,
    catalogPath,
    cognito: {
      userPoolId: pool,
      clientId: client,
      domain: at,
      clientSecretParameter: secretParameter,
    },
    web: { origins, callbackUrl, signOutUrl },
    extension: { port: extensionPort, sessionToken },
    model,
  };
}
