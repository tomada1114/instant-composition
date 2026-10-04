import { errorCode, SIGN_IN_URL } from "./api-call";

/**
 * How one sign-in ended: the session cookies are set, the email and password
 * sign nobody in, the account needs an administrator first, or no readable
 * answer came back and the same sign-in may be sent again.
 */
export type SignInOutcome = "signed-in" | "refused" | "action-required" | "failed";

/**
 * Posts `email` and `password` to the API's sign-in endpoint, exactly as
 * typed. It is a plain `fetch` rather than `send`: a refused password is an
 * answer for the form to show, never a session for the shared renewal to
 * refresh or a reason to send the browser to sign in again.
 */
export async function signInWith(
  email: string,
  password: string,
): Promise<SignInOutcome> {
  try {
    const response = await fetch(SIGN_IN_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (response.status === 204) return "signed-in";
    const code = errorCode(await response.json().catch(() => null));
    if (code === "ERR_UNAUTHENTICATED") return "refused";
    if (code === "ERR_SIGN_IN_ACTION_REQUIRED") return "action-required";
    return "failed";
  } catch {
    return "failed";
  }
}
