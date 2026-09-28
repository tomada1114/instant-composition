import type { ErrorCode } from "@instant-composition/contracts";

/** What one web-session endpoint answers, and how the request ended for its log line. */
export interface WebSessionAnswer {
  readonly response: Response;
  readonly outcome: "ok" | ErrorCode;
}

type Endpoint = (request: Request) => Promise<WebSessionAnswer>;

/**
 * The endpoints that keep a browser's tokens in HttpOnly cookies, so page
 * scripts never hold one (ADR-0005, Web). Each is named as its log line's
 * `operation`.
 */
export interface WebSession {
  /** Sends the browser to the managed login, with a fresh `state` and PKCE challenge. */
  readonly startSignIn: Endpoint;
  /** Checks the `state`, redeems the code, and keeps the tokens in cookies. */
  readonly finishSignIn: Endpoint;
  /** Renews the access token from the refresh token cookie. */
  readonly refreshSession: Endpoint;
  /** Revokes the refresh token, drops the cookies and signs the browser out of the managed login. */
  readonly signOut: Endpoint;
}

/** Where each web-session endpoint is served, relative to the API root. */
export const WEB_SESSION_ROUTES = [
  { method: "GET", path: "/v1/auth/login", operation: "startSignIn" },
  { method: "GET", path: "/v1/auth/callback", operation: "finishSignIn" },
  { method: "POST", path: "/v1/auth/refresh", operation: "refreshSession" },
  { method: "POST", path: "/v1/auth/logout", operation: "signOut" },
] as const satisfies readonly {
  method: "GET" | "POST";
  path: string;
  operation: keyof WebSession;
}[];
