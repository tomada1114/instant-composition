import type { TalkError } from "./errors";
import { err, ok, type Result } from "./result";
import type { Talk, Turn } from "./talk";
import { isClosing, keptTalk } from "./talk-start";

/**
 * What `retryReply` does: answer the latest turn's kept reply, or ask the
 * partner again for it. An ended talk takes no new reply; a finished one
 * still does, since its last turn may have been kept without one.
 */
export function decideReply(
  talk: Talk | undefined,
): Result<
  | { readonly kind: "kept"; readonly line: string; readonly closing: boolean }
  | { readonly kind: "ask"; readonly talk: Talk; readonly turn: Turn },
  TalkError
> {
  if (talk === undefined) {
    return err({ code: "ERR_TALK_NOT_FOUND" });
  }
  const latest = talk.turns.at(-1);
  if (latest?.reply !== undefined) {
    return ok({ kind: "kept", line: latest.reply, closing: isClosing(latest) });
  }
  if (talk.status === "ended" || talk.status === "discarded") {
    return err({ code: "ERR_TALK_CLOSED" });
  }
  return latest === undefined
    ? err({ code: "ERR_CONFLICT" })
    : ok({ kind: "ask", talk, turn: latest });
}

/** `talk` with `line` kept as turn `n`'s reply. */
export function withReply(talk: Talk, n: number, line: string): Talk {
  return {
    ...talk,
    turns: talk.turns.map((turn) => (turn.n === n ? { ...turn, reply: line } : turn)),
  };
}

/**
 * `talk` with turn `turn`'s reveal count set; the same talk when it already
 * holds that count, so a resend writes nothing. A turn not kept yet is
 * `ERR_CONFLICT`.
 */
export function decideRecital(
  talk: Talk | undefined,
  command: { readonly turn: number; readonly revealCount: number },
): Result<Talk, TalkError> {
  if (talk === undefined) {
    return err({ code: "ERR_TALK_NOT_FOUND" });
  }
  if (!Number.isSafeInteger(command.revealCount) || command.revealCount < 0) {
    return err({ code: "ERR_BAD_REQUEST" });
  }
  const turn = talk.turns.find((kept) => kept.n === command.turn);
  if (turn === undefined) {
    return err({ code: "ERR_CONFLICT" });
  }
  if (turn.revealCount === command.revealCount) {
    return ok(talk);
  }
  return ok({
    ...talk,
    turns: talk.turns.map((kept) =>
      kept === turn ? { ...kept, revealCount: command.revealCount } : kept,
    ),
  });
}

/**
 * What `endTalk` leaves: an open talk holding a turn is `ended` and kept, one
 * holding none `discarded` and left to expire. A talk already closed answers
 * the same `kept` again and is not changed.
 */
export function decideEnd(
  talk: Talk | undefined,
  now: number,
): Result<{ readonly kept: boolean; readonly talk: Talk }, TalkError> {
  if (talk === undefined) {
    return err({ code: "ERR_TALK_NOT_FOUND" });
  }
  if (talk.status !== "open") {
    return ok({ kept: talk.status !== "discarded", talk });
  }
  return talk.turns.length === 0
    ? ok({ kept: false, talk: { ...talk, status: "discarded", endedAt: now } })
    : ok({ kept: true, talk: keptTalk(talk, "ended", now) });
}
