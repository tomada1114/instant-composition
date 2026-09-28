import type { ParametersExtension } from "./env-settings";
import type { Fetch } from "./token-endpoint";

/**
 * A secret could not be read from Parameter Store: the extension could not be
 * reached, answered an error, or the parameter is not a `SecureString`. It
 * carries the extension's HTTP status alone — never the parameter's value,
 * the session token or the answer's body.
 */
export class SecretParameterError extends Error {
  readonly code = "ERR_API_SECRET_UNREADABLE" as const;
  /** The status the extension answered, or `null` when it answered none or not the shape expected. */
  readonly status: number | null;

  constructor(status: number | null, why: string, options?: ErrorOptions) {
    super(`A secret parameter could not be read: ${why}.`, options);
    this.name = "SecretParameterError";
    this.status = status;
  }
}

/** How long a read may take: the extension answers from its cache, or asks Parameter Store once. */
const TIMEOUT_MS = 5_000;

interface ParameterAnswer {
  readonly Parameter: { readonly Type: string; readonly Value: string };
}

function isParameterAnswer(body: unknown): body is ParameterAnswer {
  if (typeof body !== "object" || body === null || !("Parameter" in body)) {
    return false;
  }
  const parameter = body.Parameter;
  return (
    typeof parameter === "object" &&
    parameter !== null &&
    "Type" in parameter &&
    typeof parameter.Type === "string" &&
    "Value" in parameter &&
    typeof parameter.Value === "string"
  );
}

/**
 * The decrypted value of the `SecureString` parameter `name`, read through the
 * AWS Parameters and Secrets Lambda extension on localhost (ADR-0009). The
 * extension keeps each value in its own cache for at most 300 seconds, so a
 * caller asks it on every use rather than holding the value itself: a rotated
 * secret then reaches a running function within that bound.
 *
 * @throws {@link SecretParameterError} when the extension cannot be reached,
 * answers anything but 200 with a parameter, or the parameter is stored as
 * plain text, which ADR-0009 does not allow for a secret.
 */
export async function readSecureString(
  extension: ParametersExtension,
  name: string,
  fetch: Fetch,
): Promise<string> {
  const query = new URLSearchParams({ name, withDecryption: "true" });
  let response: Response;
  try {
    response = await fetch(
      new Request(
        `http://localhost:${String(extension.port)}/systemsmanager/parameters/get?${query.toString()}`,
        {
          headers: { "x-aws-parameters-secrets-token": extension.sessionToken },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      ),
    );
  } catch (error) {
    throw new SecretParameterError(null, "the extension could not be reached", {
      cause: error,
    });
  }
  if (response.status !== 200) {
    throw new SecretParameterError(
      response.status,
      `the extension answered ${String(response.status)}`,
    );
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!isParameterAnswer(body)) {
    throw new SecretParameterError(null, "the extension answered no parameter");
  }
  if (body.Parameter.Type !== "SecureString") {
    throw new SecretParameterError(null, "the parameter is not a SecureString");
  }
  return body.Parameter.Value;
}
