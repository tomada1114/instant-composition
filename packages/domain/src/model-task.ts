import type { TalkTask } from "./talk";
import { TALK_TUNING } from "./tuning";

/** One semantic model job, scoped to a learner by the store that holds it. */
export interface ModelTaskKey {
  readonly talkId: string;
  readonly task: TalkTask;
  /** Zero for scene and candidates; the turn number for teacher and partner. */
  readonly turn: number;
  readonly promptVersion: string;
  /** The stored talk start time for turn/candidates tasks; an expired talk id may be reused. */
  readonly generation?: number;
}

/** A claim's immutable input and execution history; none of its text reaches a log. */
export interface ModelTaskIdentity {
  readonly key: ModelTaskKey;
  /** Server request identity plus attempt; fences deletion and recreation as well as lease recovery. */
  readonly claimId: string;
  /** The exact serialized request, excluding its reader and execution metadata. */
  readonly input: string;
  readonly attempt: number;
  readonly duplicatePossible: boolean;
  readonly startedAt: number;
  /** Epoch seconds; task recovery data expires independently of a kept talk. */
  readonly expiresAt: number;
}

/** A model task's durable claim, saved answer, or failed attempt. */
export type ModelTask = ModelTaskIdentity &
  (
    | { readonly state: "in-flight"; readonly leaseUntil: number }
    | { readonly state: "result"; readonly result: unknown }
    | {
        readonly state: "failed";
        readonly outcome: "known" | "unknown";
        readonly reason: string;
      }
  );

/** The pure decision before paying for a model call. */
export type ModelTaskDecision =
  | {
      readonly kind: "claim";
      readonly task: Extract<ModelTask, { state: "in-flight" }>;
    }
  | { readonly kind: "result"; readonly result: unknown }
  | { readonly kind: "busy" }
  | { readonly kind: "mismatch" };

/**
 * Replays a saved result, refuses concurrent work and changed input, or claims
 * a new attempt. A request after failure or lease expiry is the explicit retry;
 * an expired lease is an unknown provider outcome, never proof it did no work.
 */
export function decideModelTask(
  stored: ModelTask | undefined,
  key: ModelTaskKey,
  input: string,
  now: number,
  requestId: string,
): ModelTaskDecision {
  const live =
    stored !== undefined && now < stored.expiresAt * 1_000 ? stored : undefined;
  if (live !== undefined) {
    if (live.input !== input) return { kind: "mismatch" };
    if (live.state === "result") return { kind: "result", result: live.result };
    if (live.state === "in-flight" && now < live.leaseUntil) return { kind: "busy" };
  }
  return {
    kind: "claim",
    task: {
      key,
      claimId: `${requestId}:${String((live?.attempt ?? 0) + 1)}`,
      input,
      state: "in-flight",
      attempt: (live?.attempt ?? 0) + 1,
      duplicatePossible:
        live !== undefined &&
        (live.duplicatePossible ||
          live.state === "in-flight" ||
          live.outcome === "unknown"),
      startedAt: now,
      leaseUntil: now + TALK_TUNING.modelLeaseMs,
      expiresAt: Math.floor((now + TALK_TUNING.expiresAfterMs) / 1_000),
    },
  };
}
