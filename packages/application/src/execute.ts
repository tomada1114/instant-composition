import { dayOf, err, ok, type DayKey, type Result } from "@instant-composition/domain";

import type { Catalog } from "./catalog";
import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { authorize, type OperationKind } from "./operations";
import type { Commit, Entry, LearnerStore, LearnerStores } from "./store";

/** What every command and query is handed besides its context. */
export interface ApplicationDeps {
  readonly stores: LearnerStores;
  readonly catalog: Catalog;
}

/** One entry to write, and the version it was read at, if it was there. */
export type Write = readonly [Entry, { readonly version: number } | undefined];

/** A put for an entry that was not there, an update at the version read otherwise. */
export function commitOf(writes: readonly Write[]): Commit {
  return {
    puts: writes.filter(([, read]) => read === undefined).map(([entry]) => entry),
    updates: writes.flatMap(([entry, read]) =>
      read === undefined ? [] : [{ entry, version: read.version }],
    ),
    expect: [],
  };
}

/** A decision: what to hand back, and what to write for it. */
export interface Planned<T> {
  readonly value: T;
  readonly writes: readonly Write[];
}

/** How often a command re-runs from its load after another write won the race. */
const MAX_ATTEMPTS = 3;

/**
 * Commits what `plan` decides, loading and deciding again whenever a condition
 * of the commit no longer held. A plan that writes nothing commits nothing.
 */
export async function committed<T>(
  store: LearnerStore,
  plan: () => Promise<Result<Planned<T>, ApplicationError>>,
): Promise<Result<T, ApplicationError>> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const planned = await plan();
    if (!planned.ok) {
      return planned;
    }
    if (planned.value.writes.length === 0) {
      return ok(planned.value.value);
    }
    const written = await store.commit(commitOf(planned.value.writes));
    if (written.ok) {
      return ok(planned.value.value);
    }
  }
  return err({ code: "ERR_CONFLICT" });
}

/** The learner's store, once the actor is allowed to run `kind`. */
export function storeFor(
  deps: ApplicationDeps,
  context: RequestContext,
  kind: OperationKind,
): Result<LearnerStore, ApplicationError> {
  const allowed = authorize(context.actor, { kind });
  return allowed.ok ? ok(deps.stores.forLearner(context.learner.id)) : allowed;
}

/** The practice day `context.now` falls on, in the learner's own time zone. */
export function todayOf(context: RequestContext): DayKey {
  return dayOf(context.now, context.learner.timeZone, context.learner.dayBoundaryHour);
}
