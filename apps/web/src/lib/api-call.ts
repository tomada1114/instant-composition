// How every call in `endpoints.ts` reaches the API: the root, the URL a
// contract path becomes, and how an answer is read into a `Result`.
import { err, ok, type Result } from "./result";

/**
 * The API's root on the SPA's own origin: `openapi.json`'s
 * `servers` entry, which the Vite dev server proxies to the local API.
 */
export const API_ROOT = "/api";

/** An error code from the API, or `ERR_NETWORK` when no readable answer came back. */
export interface ApiError {
  readonly code: string;
}

const NETWORK: ApiError = { code: "ERR_NETWORK" };

/** What became of one send: delivered, refused for good, or worth retrying. */
export type SendOutcome =
  | "sent"
  | "rejected"
  | "failed"
  | { readonly status: "failed"; readonly retryAt: number };

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
  readonly path?: Readonly<Record<string, string | number>>;
  readonly body?: unknown;
}

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

/** `data.url` under {@link API_ROOT}, each `{name}` filled with its encoded path parameter. */
export function operationUrl(data: OperationData): string {
  const filled = data.url.replace(/\{(\w+)\}/gu, (_, name: string) =>
    encodeURIComponent(String(data.path?.[name] ?? "")),
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
 * Whether a call in this visit has been answered signed in. Until one has, a
 * refusal the refresh cannot lift means nobody signed in before the visit
 * began; once one has, it means the session ran out while the app was open.
 */
let signedIn = false;
let redirecting: Promise<never> | undefined;

/** Starts a visit in which nobody is yet known to be signed in: each page load, and each mount of the app. */
export function beginVisit(): void {
  signedIn = false;
  redirecting = undefined;
}

/**
 * Sends one call. An `ERR_UNAUTHENTICATED` answer renews the session once and
 * sends the call again. When renewal fails, or the retry is refused too, the
 * refusal is the answer if nothing in this visit was signed in yet — a visitor
 * who is signed out, whom the screens show the landing screen — and otherwise
 * the browser is sent to sign in. At most one refresh per call, so this never
 * loops. Once the browser is on its way to sign in, the call never settles, so
 * a screen stays in its loading state instead of flashing a failure before
 * the page unloads.
 */
export async function send(method: Method, data: OperationData): Promise<Response> {
  let answer = await request(method, data);
  if ((await isUnauthenticated(answer)) && (await refreshSession())) {
    answer = await request(method, data);
  }
  if (!(await isUnauthenticated(answer))) {
    if (answer.ok) signedIn = true;
    return answer;
  }
  return signedIn ? signIn() : answer;
}

function signIn(): Promise<never> {
  if (redirecting === undefined) {
    redirecting = new Promise<never>(() => undefined);
    globalThis.location.assign(LOGIN_URL);
  }
  return redirecting;
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
