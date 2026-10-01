import type { Random } from "./random";
import type { SceneKind, Scene, Talk, TalkModel, Turn } from "./talk";
import { TALK_TUNING } from "./tuning";

/**
 * The talk as a command may act on it: absent once its `expiresAt` has passed,
 * since the table's TTL deletes late and both stores must read alike.
 */
export function liveTalk(talk: Talk | undefined, now: number): Talk | undefined {
  return talk?.expiresAt !== undefined && talk.expiresAt * 1000 <= now
    ? undefined
    : talk;
}

/** The kind of scene a talk gets: `self` about `TALK_TUNING.selfShare` of the time. */
export function sceneKindOf(random: Random): SceneKind {
  return random() < TALK_TUNING.selfShare ? "self" : "errand";
}

/** A talk just started at `now`: open, holding no turn, expiring a day later. */
export function openTalk(start: {
  readonly id: string;
  readonly now: number;
  readonly scene: Scene;
  readonly opening: string;
  readonly model: TalkModel;
}): Talk {
  return {
    id: start.id,
    status: "open",
    startedAt: start.now,
    expiresAt: Math.floor((start.now + TALK_TUNING.expiresAfterMs) / 1000),
    scene: start.scene,
    opening: start.opening,
    turns: [],
    model: start.model,
  };
}

/** `talk` kept for good: it no longer expires. */
export function keptTalk(talk: Talk, status: "finished" | "ended", now: number): Talk {
  return {
    id: talk.id,
    status,
    startedAt: talk.startedAt,
    endedAt: now,
    scene: talk.scene,
    opening: talk.opening,
    turns: talk.turns,
    model: talk.model,
  };
}

/** Whether `turn`'s reply is the one that closes the talk. */
export function isClosing(turn: Turn): boolean {
  return turn.n === TALK_TUNING.turns;
}
