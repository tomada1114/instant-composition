import { clearLearnerStorage } from "./learner-storage";
// How every call in `endpoints.ts` reaches the API: the root, the URL a
// contract path becomes, and how an answer is read into a `Result`.
import { waitForPreparedRead } from "./read-model-wait";
import { retryAt } from "./retry-after";
import { err, ok, type Result } from "./result";
import {
  renewSession,
  observeSession,
  submitSignOut,
  visitSession,
} from "./session-renewal";

/**
 * The API's root on the SPA's own origin: `openapi.json`'s
 * `servers` entry, which the Vite dev server proxies to the local API.
 */
export const API_ROOT = "/api";

/** An error code from the API, or `ERR_NETWORK` when no readable answer came back. */
export interface ApiError {
  readonly code: string;
  readonly retryAt?: number;
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

/** The web client's own sign-in page, where a session that ran out sends the browser. */
export const LOGIN_URL = "/login";

/** Signs an email and password in; outside the contract's routes, so called by path. */
export const SIGN_IN_URL = `${API_ROOT}/v1/auth/login`;

/** Renews the session cookies from the refresh cookie; outside the contract's routes, so called by path. */
export const REFRESH_URL = `${API_ROOT}/v1/auth/refresh`;

/** Signs out: posted by a top-level form, since the answer is a 303 to the sign-in page. */
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

/**
 * Whether a call in this visit has been answered signed in. Until one has, a
 * refusal the refresh cannot lift means nobody signed in before the visit
 * began; once one has, it means the session ran out while the app was open.
 */
let signedIn = false;
let redirecting: Promise<never> | undefined;
let visit = 0;

/** Starts a visit in which nobody is yet known to be signed in: each page load, and each mount of the app. */
export function beginVisit(): void {
  visit += 1;
  signedIn = false;
  redirecting = undefined;
  visitSession();
}

/** Leaves only after cookie renewal settles; stale calls cannot sign the visit in again. */
export function signOut(form: HTMLFormElement): Promise<void> {
  visit += 1;
  signedIn = false;
  return submitSignOut(form, clearLearnerStorage);
}

/**
 * Shares cookie renewal across concurrent 401s and retries each original call
 * once. Temporary renewal failures return a retryable network error. A terminal
 * refusal is checked once against the current cookies before signing in, so an
 * older tab's failed rotation cannot overrule another tab's newer success.
 * A signed-in visit navigates to login only after confirmed refusal; navigation
 * stays pending to preserve the current screen until the document unloads.
 */
export async function send(method: Method, data: OperationData): Promise<Response> {
  const currentVisit = visit;
  const observed = observeSession();
  let answer = await request(method, data);
  if (await isUnauthenticated(answer)) {
    if (currentVisit !== visit) return answer;
    const renewed = await renewSession(REFRESH_URL, observed);
    if (renewed === "unavailable") {
      return Response.json({ error: NETWORK }, { status: 503 });
    }
    if (currentVisit !== visit) return answer;
    // A terminal refusal may be from an older cookie another tab already rotated.
    // One retry checks the actual credential before deciding to sign in.
    answer = await request(method, data);
  }
  if (currentVisit !== visit) {
    return Response.json({ error: { code: "ERR_UNAUTHENTICATED" } }, { status: 401 });
  }
  if (!(await isUnauthenticated(answer))) {
    if (answer.ok) signedIn = true;
    return answer;
  }
  await clearLearnerStorage();
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
    const initial = await send(method, data);
    const response =
      method === "GET"
        ? await waitForPreparedRead(initial, () => send(method, data), errorCode)
        : initial;
    if (response.ok) return ok((await response.json()) as TResponses[200]);
    const code = errorCode(await response.json().catch(() => null)) ?? "ERR_NETWORK";
    const deadline = retryAt(response.headers.get("Retry-After"));
    return err({ code, ...(deadline === undefined ? {} : { retryAt: deadline }) });
  } catch {
    return err(NETWORK);
  }
}
