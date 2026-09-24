/**
 * The configuration of a local run of the API, read from the environment.
 *
 * @remarks
 * This is the only module in `apps/api` that reads `process.env`; everything
 * else is handed what it needs as an argument. No `.env` file is loaded: a
 * local run takes these names from the shell that starts it, and every one of
 * them has a default, so `pnpm api` needs none set.
 */
export interface ApiEnv {
  readonly port: number;
  /** DynamoDB local's endpoint; `localDynamoDbClient` refuses one off the loopback. */
  readonly dynamoDbEndpoint: string;
  readonly tableName: string;
  /** The catalog snapshot `pnpm catalog:build` writes, relative to the working directory or absolute. */
  readonly catalogPath: string;
  /** The stand-in learner's id and time zone, or `undefined` for its own default. */
  readonly learnerId: string | undefined;
  readonly learnerTimeZone: string | undefined;
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

/** A learner id as the stores key it: short, and nothing a key separator could split. */
const learnerKey: Parse<string> = (value) =>
  /^[\w-]{1,64}$/.test(value) ? value : undefined;

const timeZone: Parse<string> = (value) => {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions()
      .timeZone;
  } catch {
    return undefined;
  }
};

/** Every variable {@link readApiEnv} reads. */
export const API_ENV_NAMES = [
  "API_PORT",
  "API_DYNAMODB_ENDPOINT",
  "API_TABLE_NAME",
  "API_CATALOG_PATH",
  "API_LOCAL_LEARNER_ID",
  "API_LOCAL_LEARNER_TIME_ZONE",
] as const;

/**
 * Variables AWS sets in every process it runs. The local run authenticates
 * nobody, so it refuses to start where any of them is present.
 */
const HOSTED_MARKERS = [
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_EXECUTION_ENV",
  "ECS_CONTAINER_METADATA_URI",
];

type Source = Readonly<Record<string, string | undefined>>;

/**
 * Reads and validates the local run's environment. A blank value reads as
 * unset, and surrounding whitespace is dropped.
 *
 * @throws {@link ApiEnvError} `ERR_API_ENV_INVALID` naming every variable that
 * holds no value its setting accepts, or `ERR_API_ENV_NOT_LOCAL` when AWS runs
 * the process.
 */
export function readApiEnv(source: Source = process.env): ApiEnv {
  const hosted = HOSTED_MARKERS.filter((name) => (source[name] ?? "") !== "");
  if (hosted.length > 0) {
    throw new ApiEnvError(
      "ERR_API_ENV_NOT_LOCAL",
      hosted,
      "The local API authenticates no one and serves only a process on this machine; it refuses to start where AWS runs it.",
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
  const env: ApiEnv = {
    port: read("API_PORT", port) ?? 8787,
    dynamoDbEndpoint: read("API_DYNAMODB_ENDPOINT", httpUrl) ?? "http://localhost:8000",
    tableName: read("API_TABLE_NAME", tableName) ?? "instant-composition-local",
    catalogPath: read("API_CATALOG_PATH", text) ?? "dist/catalog/en/ja.json",
    learnerId: read("API_LOCAL_LEARNER_ID", learnerKey),
    learnerTimeZone: read("API_LOCAL_LEARNER_TIME_ZONE", timeZone),
  };
  if (invalid.length > 0) {
    throw new ApiEnvError(
      "ERR_API_ENV_INVALID",
      invalid,
      `These variables hold no value their setting accepts: ${invalid.join(", ")}.`,
    );
  }
  return env;
}
