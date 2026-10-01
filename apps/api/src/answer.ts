import {
  requestContext,
  signIn,
  type ApplicationDeps,
  type SignInDeps,
} from "@instant-composition/application";
import type { Route } from "@instant-composition/contracts";

import type { Authenticator } from "./authenticator";
import { failure, readJsonBody } from "./http";
import type { LogLine, LogSink, RequestOutcome } from "./log";
import { loggedModel, type ServedModel } from "./model-log";
import type { Operation } from "./operations";
import { readPath } from "./routes";
import type { WebSession } from "./web-session";

/**
 * Everything the app is handed, so a test runs it with no network and a fixed
 * clock. Signing in is the edge's alone: an operation never sees the directory.
 */
export interface ApiDependencies extends ApplicationDeps, SignInDeps {
  readonly authenticator: Authenticator;
  /** Epoch milliseconds: the request's `now`, and both ends of its duration. */
  readonly now: () => number;
  readonly requestId: () => string;
  /** Each request's line and each model call's. */
  readonly log: LogSink;
  /** The model the talk operations call, each call logged against its request. */
  readonly model: ServedModel;
  /**
   * The web sign-in endpoints under `/v1/auth/`, served only when given: a run
   * with no user pool has nothing to sign a browser in to.
   */
  readonly webSession?: WebSession | undefined;
}

export interface Answered {
  readonly response: Response;
  readonly outcome: RequestOutcome;
  readonly learnerId: string | null;
  readonly reason: LogLine["reason"];
}

function refused(
  code: Parameters<typeof failure>[0],
  learnerId: string | null,
  reason: LogLine["reason"] = null,
): Answered {
  return { response: failure(code), outcome: code, learnerId, reason };
}

/** Authenticate and sign in, check the path and the body, run the operation, answer. */
export async function answer(
  route: Route,
  operation: Operation,
  deps: ApiDependencies,
  request: Request,
  params: Readonly<Record<string, string>>,
  requestId: string,
): Promise<Answered> {
  const principal = await deps.authenticator.authenticate(request);
  if (!principal.ok) {
    return refused(principal.error.code, null);
  }
  const signedIn = await signIn(deps, principal.value.subject);
  if (!signedIn.ok) {
    return refused(signedIn.error.code, null);
  }
  const learner = signedIn.value;
  const learnerId = learner.id;
  const context = requestContext({
    actor: { kind: "learner", learnerId },
    learner,
    now: deps.now(),
    requestId,
  });
  if (!context.ok) {
    return refused(context.error.code, learnerId);
  }
  const path = readPath(operation.params, params);
  if (path === undefined) {
    return refused("ERR_BAD_REQUEST", learnerId);
  }
  let body: unknown = undefined;
  if (operation.body !== null) {
    const read = await readJsonBody(request);
    if (!read.ok) {
      return refused(read.error, learnerId);
    }
    body = read.value;
  }
  const outcome = await operation.handle({
    deps: {
      stores: deps.stores,
      catalog: deps.catalog,
      model: loggedModel(deps.model, { requestId, log: deps.log, now: deps.now }),
      // Each model call ends at its bound, or when the caller hangs up.
      deadline: (ms) => AbortSignal.any([request.signal, AbortSignal.timeout(ms)]),
    },
    context: context.value,
    path,
    body,
  });
  if (!outcome.ok) {
    return refused(outcome.error.code, learnerId, outcome.error.reason ?? null);
  }
  const response =
    route.success.status === 204
      ? new Response(null, { status: 204 })
      : Response.json(outcome.value, { status: route.success.status });
  return { response, outcome: "ok", learnerId, reason: null };
}
