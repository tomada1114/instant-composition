/**
 * The configuration of a local run of the API, read from the environment.
 *
 * @remarks
 * This is the only module in `apps/api` that reads `process.env`; everything
 * else is handed what it needs as an argument. No `.env` file is loaded: a
 * local run takes these names from the shell that starts it, and every one of
 * them has a default or is optional, so `pnpm api` needs none set.
 */
export interface ApiEnv {
  readonly port: number;
  /** DynamoDB local's endpoint; `localDynamoDbClient` refuses one off the loopback. */
  readonly dynamoDbEndpoint: string;
  readonly tableName: string;
  /** The catalog snapshot `pnpm catalog:build` writes, relative to the working directory or absolute. */
  readonly catalogPath: string;
  /** The user pool whose access tokens the API accepts; `null` runs the stand-in authenticator. */
  readonly cognito: CognitoSettings | null;
}

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

/** A variable held no value its setting accepts, or the process is not a local one. */
export class ApiEnvError extends Error {
  readonly code: "ERR_API_ENV_INVALID" | "ERR_API_ENV_NOT_LOCAL";
  /** The variables at fault, by name; never their values. */
  readonly names: readonly string[];

  constructor(code: ApiEnvError["code"], names: readonly string[], message: string) {
    super(message);
    this.name = "ApiEnvError";
    this.code = code;
    this.names = names;
  }
}

type Parse<T> = (value: string) => T | undefined;

const text: Parse<string> = (value) => value;

const port: Parse<number> = (value) => {
  const number = /^\d{1,5}$/.test(value) ? Number(value) : 0;
  return number >= 1 && number <= 65_535 ? number : undefined;
};

const httpUrl: Parse<string> = (value) =>
  /^https?:$/.test(URL.parse(value)?.protocol ?? "") ? value : undefined;

/** DynamoDB's own rule for a table name. */
const tableName: Parse<string> = (value) =>
  /^[\w.-]{3,255}$/.test(value) ? value : undefined;

/** A user pool id as Cognito shapes it, `<region>_<id>` (the rule `aws-jwt-verify` applies). */
const userPoolId: Parse<string> = (value) =>
  /^(?:eusc-[a-z]{2}|[a-z]{2})-(?:gov-)?[a-z]+-\d_[a-zA-Z0-9]+$/.test(value)
    ? value
    : undefined;

/** An app client id as Cognito shapes it. */
const clientId: Parse<string> = (value) =>
  /^[\w+]{1,128}$/.test(value) ? value : undefined;

/** An app client secret as Cognito shapes it. */
const clientSecret: Parse<string> = (value) =>
  /^[\w+]{1,64}$/.test(value) ? value : undefined;

/** A user pool domain's base URL: https, and nothing after the host. */
const domain: Parse<string> = (value) => {
  const url = URL.parse(value);
  return url?.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === ""
    ? url.origin
    : undefined;
};

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

type Source = Readonly<Record<string, string | undefined>>;

function blank(source: Source, name: string): boolean {
  return (source[name]?.trim() ?? "") === "";
}

/**
 * Reads and validates the local run's environment. A blank value reads as
 * unset, and surrounding whitespace is dropped.
 *
 * The four `API_COGNITO_*` names are set together or not at all: all set wire
 * the Cognito authenticator and the web sign-in endpoints, none the stand-in.
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
  const invalid: string[] = [];
  function read<T>(
    name: (typeof API_ENV_NAMES)[number],
    parse: Parse<T>,
  ): T | undefined {
    const raw = source[name]?.trim() ?? "";
    const value = raw === "" ? undefined : parse(raw);
    if (raw !== "" && value === undefined) {
      invalid.push(name);
    }
    return value;
  }
  const env: Omit<ApiEnv, "cognito"> = {
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
  if (invalid.length > 0) {
    throw new ApiEnvError(
      "ERR_API_ENV_INVALID",
      invalid,
      `These variables hold no value their setting accepts: ${invalid.join(", ")}.`,
    );
  }
  return {
    ...env,
    cognito:
      pool === undefined ||
      client === undefined ||
      secret === undefined ||
      at === undefined
        ? null
        : { userPoolId: pool, clientId: client, clientSecret: secret, domain: at },
  };
}
