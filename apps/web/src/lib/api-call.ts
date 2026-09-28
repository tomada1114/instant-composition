// How every call in `endpoints.ts` reaches the API: the root, the URL a
// contract path becomes, and how an answer is read into a `Result`.
import { err, ok, type Result } from "./result";

/**
 * The API's root on the SPA's own origin (ADR-0008): `openapi.json`'s
 * `servers` entry, which the Vite dev server proxies to the local API.
 */
export const API_ROOT = "/api";

/** An error code from the API, or `ERR_NETWORK` when no readable answer came back. */
export interface ApiError {
  readonly code: string;
}

const NETWORK: ApiError = { code: "ERR_NETWORK" };

/** What became of one send: delivered, refused for good, or worth retrying. */
export type SendOutcome = "sent" | "rejected" | "failed";

/**
 * The shape every generated `<Operation>Data` type has: the path template,
 * what fills it, and the body.
 *
 * @remarks
 * Each call below checks what it sends against its operation's generated
 * `Data` type and reads the answer as its `Responses` type, so the template,
 * the body and the answer are the contract's rather than strings and casts
 * written here.
 */
export interface OperationData {
  readonly url: string;
  readonly path?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export type Method = "GET" | "POST" | "PATCH";

/** `data.url` under {@link API_ROOT}, each `{name}` filled with its encoded path parameter. */
export function operationUrl(data: OperationData): string {
  const filled = data.url.replace(/\{(\w+)\}/gu, (_, name: string) =>
    encodeURIComponent(data.path?.[name] ?? ""),
  );
  return `${API_ROOT}${filled}`;
}

/** Where the browser goes to sign in: a full-page navigation to the API's managed-login redirect. */
export const LOGIN_URL = `${API_ROOT}/v1/auth/login`;

/** Renews the session cookies from the refresh cookie; outside the contract's routes, so called by path. */
export const REFRESH_URL = `${API_ROOT}/v1/auth/refresh`;

/** Signs out: posted by a top-level form, since the answer is a 303 to another origin. */
export const LOGOUT_URL = `${API_ROOT}/v1/auth/logout`;

function request(method: Method, data: OperationData): Promise<Response> {
  return fetch(
    operationUrl(data),
    data.body === undefined
      ? { method }
      : {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data.body),
        },
  );
}

async function isUnauthenticated(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  return errorCode(body) === "ERR_UNAUTHENTICATED";
}

/** Only a 204 renews the session; a 404 (no user pool configured) or a refusal does not. */
async function refreshSession(): Promise<boolean> {
  try {
    const response = await fetch(REFRESH_URL, {
      method: "POST",
      credentials: "same-origin",
    });
    return response.status === 204;
  } catch {
    return false;
  }
}

/**
 * Sends one call. An `ERR_UNAUTHENTICATED` answer renews the session once and
 * sends the call again; when renewal fails, or the retry is refused too, the
 * browser is sent to sign in. At most one refresh per call, so this never loops.
 */
export async function send(method: Method, data: OperationData): Promise<Response> {
  const first = await request(method, data);
  if (!(await isUnauthenticated(first))) return first;
  if (await refreshSession()) {
    const retry = await request(method, data);
    if (!(await isUnauthenticated(retry))) return retry;
    globalThis.location.assign(LOGIN_URL);
    return retry;
  }
  globalThis.location.assign(LOGIN_URL);
  return first;
}

/** The envelope's `error.code`, or `undefined` for a body that is not the envelope. */
export function errorCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return undefined;
  }
  const { error } = body;
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

/** Reads a JSON answer: the body on success, the API's error code otherwise. */
export async function call<TResponses extends { 200: unknown }>(
  method: Method,
  data: OperationData,
): Promise<Result<TResponses[200], ApiError>> {
  try {
    const response = await send(method, data);
    const body: unknown = await response.json();
    if (response.ok) return ok(body as TResponses[200]);
    const code = errorCode(body);
    return err(code === undefined ? NETWORK : { code });
  } catch {
    return err(NETWORK);
  }
}
