// The rules a configuration value is held to, shared by the local run's and
// the hosted entry's readers in ./env. Nothing here reads `process.env`.

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

export type Parse<T> = (value: string) => T | undefined;

export type Source = Readonly<Record<string, string | undefined>>;

export const text: Parse<string> = (value) => value;

export const port: Parse<number> = (value) => {
  const number = /^\d{1,5}$/.test(value) ? Number(value) : 0;
  return number >= 1 && number <= 65_535 ? number : undefined;
};

export const httpUrl: Parse<string> = (value) =>
  /^https?:$/.test(URL.parse(value)?.protocol ?? "") ? value : undefined;

/** DynamoDB's own rule for a table name. */
export const tableName: Parse<string> = (value) =>
  /^[\w.-]{3,255}$/.test(value) ? value : undefined;

/** A user pool id as Cognito shapes it, `<region>_<id>` (the rule `aws-jwt-verify` applies). */
export const userPoolId: Parse<string> = (value) =>
  /^(?:eusc-[a-z]{2}|[a-z]{2})-(?:gov-)?[a-z]+-\d_[a-zA-Z0-9]+$/.test(value)
    ? value
    : undefined;

/** An app client id as Cognito shapes it. */
export const clientId: Parse<string> = (value) =>
  /^[\w+]{1,128}$/.test(value) ? value : undefined;

/** An app client secret as Cognito shapes it. */
export const clientSecret: Parse<string> = (value) =>
  /^[\w+]{1,64}$/.test(value) ? value : undefined;

/** An https URL carrying no credentials and no fragment, kept exactly as written. */
export const httpsUrl: Parse<string> = (value) => {
  const url = URL.parse(value);
  return url?.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.hash === ""
    ? value
    : undefined;
};

/** A user pool domain's base URL: https, and nothing after the host. */
export const domain: Parse<string> = (value) => {
  const url = URL.parse(value);
  return httpsUrl(value) !== undefined && url?.pathname === "/" && url.search === ""
    ? url.origin
    : undefined;
};

/** Comma-separated https origins, each written exactly as a browser sends it in `Origin`. */
export const httpsOrigins: Parse<readonly string[]> = (value) => {
  const origins = value.split(",").map((origin) => origin.trim());
  return origins.every(
    (origin) => URL.parse(origin)?.origin === origin && origin.startsWith("https://"),
  )
    ? origins
    : undefined;
};

/** An AWS Region code, such as `ap-northeast-1`. */
export const awsRegion: Parse<string> = (value) =>
  /^[a-z]{2}(?:-[a-z]+)+-\d{1,2}$/.test(value) ? value : undefined;

/** A Parameter Store parameter's name, hierarchical (`/a/b`) or not. */
export const parameterName: Parse<string> = (value) =>
  /^[\w./-]{1,1011}$/.test(value) ? value : undefined;

export function blank(source: Source, name: string): boolean {
  return (source[name]?.trim() ?? "") === "";
}

/** A reader over `source` that records every variable holding a value its setting refuses. */
export interface EnvReader {
  /** The trimmed value parsed, or `undefined` when blank or refused. */
  readonly read: <T>(name: string, parse: Parse<T>) => T | undefined;
  /** {@link EnvReader.read}, also recording the name when it is blank. */
  readonly required: <T>(name: string, parse: Parse<T>) => T | undefined;
  /** Every name at fault so far, in the order read. */
  readonly invalid: string[];
}

export function envReader(source: Source): EnvReader {
  const invalid: string[] = [];
  function read<T>(name: string, parse: Parse<T>): T | undefined {
    const raw = source[name]?.trim() ?? "";
    const value = raw === "" ? undefined : parse(raw);
    if (raw !== "" && value === undefined) {
      invalid.push(name);
    }
    return value;
  }
  return {
    read,
    required: (name, parse) => {
      if (blank(source, name)) {
        invalid.push(name);
      }
      return read(name, parse);
    },
    invalid,
  };
}

/** `ERR_API_ENV_INVALID`, naming every variable in `invalid`. */
export function invalidVariables(invalid: readonly string[]): ApiEnvError {
  return new ApiEnvError(
    "ERR_API_ENV_INVALID",
    invalid,
    `These variables hold no value their setting accepts: ${invalid.join(", ")}.`,
  );
}
