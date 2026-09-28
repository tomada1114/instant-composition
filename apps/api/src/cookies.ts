/**
 * The attributes every cookie the API sets carries. `Secure`, `Path=/` and no
 * `Domain` are what the `__Host-` prefix of each name requires, or a browser
 * drops the cookie; `HttpOnly` keeps it from page scripts (ADR-0005).
 */
const ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Lax";

/** The value of the cookie `name` in a `Cookie` header, or `undefined` when it carries none. */
export function cookieValue(header: string | null, name: string): string | undefined {
  for (const pair of header?.split(";") ?? []) {
    const at = pair.indexOf("=");
    if (at !== -1 && pair.slice(0, at).trim() === name) {
      return pair.slice(at + 1).trim();
    }
  }
  return undefined;
}

/** A `Set-Cookie` value keeping `value` under `name` for `maxAgeSeconds`. */
export function setCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Max-Age=${String(Math.floor(maxAgeSeconds))}; ${ATTRIBUTES}`;
}

/** A `Set-Cookie` value that makes a browser drop the cookie `name`. */
export function clearCookie(name: string): string {
  return `${name}=; Max-Age=0; ${ATTRIBUTES}`;
}
