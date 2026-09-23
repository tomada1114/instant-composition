import "server-only";

import * as z from "zod";

/**
 * A variable that may be absent, where a blank value means the same as absent.
 *
 * @remarks
 * `.env.example` ships every name with an empty value, so copying it to `.env`
 * — the first thing anyone does with this template — leaves `KEY=` in the
 * environment. Node reports that as `""`, not as a missing key, and treating
 * the two differently would make a copied example file a configuration error.
 *
 * The value is trimmed rather than kept as written, because every name here is
 * a credential and surrounding whitespace is never part of one. A secret pasted
 * out of a manager with a trailing newline would otherwise be a key no caller
 * can present in a matching form: a bearer token cannot carry leading or
 * trailing whitespace, so an untrimmed `API_ACCESS_KEY` would refuse every
 * request, including one sending the exact configured value.
 */
const optionalSetting = z
  .string()
  .transform((raw) => {
    const value = raw.trim();
    return value === "" ? undefined : value;
  })
  .optional();

/**
 * Every environment variable this application reads.
 *
 * @remarks
 * Adding a name here obliges a matching line in `.env.example`;
 * `tests/server-env.test.ts` asserts that correspondence rather than trusting
 * it.
 */
const serverEnvShape = z.object({
  /**
   * The shared secret a caller of a protected endpoint must present.
   *
   * @remarks
   * Optional on its own — nothing this application serves today costs money
   * to answer — but required as soon as the code that wires an endpoint says
   * that endpoint bills a provider, by passing
   * {@link ServerEnvRequirements.requiresAccessKey}.
   *
   * The endpoint compares the value against the caller's
   * `Authorization: Bearer` credential. `API_ACCESS_KEY` is authentication
   * only: it is no rate limit and no concurrency limit, which a deployment
   * that pays per request applies at an edge or gateway. See
   * `building-app-routes` for that guidance.
   */
  API_ACCESS_KEY: optionalSetting,
});

/** The validated environment, as the rest of `src/server/` sees it. */
export type ServerEnv = z.infer<typeof serverEnvShape>;

/** What the code wiring an endpoint has to tell {@link readServerEnv} about it. */
export interface ServerEnvRequirements {
  /**
   * Whether the endpoint being wired bills a provider per answer.
   *
   * @remarks
   * A Route Handler has nothing in front of it: `src/proxy.ts`'s matcher
   * excludes `api` outright. So an endpoint that costs money to answer must
   * not also be open, and `true` here is what makes that impossible to
   * forget — `readServerEnv` throws, and the server stops as it starts rather
   * than serving one request unprotected.
   *
   * It is the wiring that decides this, never the environment. Keying the
   * rule off whether a provider credential is *present* would refuse to start
   * on any machine that exports one for an unrelated reason.
   */
  readonly requiresAccessKey: boolean;
}

/** The shape, plus the one rule that spans two of its fields. */
const billedServerEnvSchema = serverEnvShape.superRefine((env, ctx) => {
  if (env.API_ACCESS_KEY !== undefined) {
    return;
  }
  ctx.addIssue({
    code: "custom",
    path: ["API_ACCESS_KEY"],
    // Names, never values: this message reaches a log and a crash report.
    message:
      "API_ACCESS_KEY is required because an endpoint this application serves bills a provider for every answer. A Route Handler has no authentication of its own, so it must not be left open.",
  });
});

/** Every name {@link serverEnvShape} declares, for the `.env.example` check. */
export const SERVER_ENV_NAMES: readonly string[] = Object.keys(serverEnvShape.shape);

/**
 * Reads and validates `process.env`.
 *
 * @remarks
 * This is the only place in `src/` that touches `process.env`; every other
 * module receives what it needs as an argument. Keeping the read here is what
 * makes "where does this secret enter the process" a question a reader answers
 * by opening one file.
 *
 * It throws rather than returning a `Result`: a malformed environment is a
 * deployment mistake with no caller-side recovery, so failing where it is read
 * is more useful than threading an error through code that cannot act on it.
 *
 * @param requirements - What the endpoint wiring demands of the environment; see {@link ServerEnvRequirements}.
 * @returns The validated environment.
 * @throws A `ZodError` naming every variable that did not match its shape, or
 * the missing `API_ACCESS_KEY` a billed endpoint obliges.
 */
export function readServerEnv(requirements: ServerEnvRequirements): ServerEnv {
  const schema = requirements.requiresAccessKey
    ? billedServerEnvSchema
    : serverEnvShape;
  return schema.parse(process.env);
}
