import {
  decideReply,
  decideTurn,
  err,
  isClosing,
  keepTurn,
  liveTalk,
  ok,
  withReply,
  type Result,
  type TurnCommand,
} from "@instant-composition/domain";

import type { RequestContext } from "./context";
import type { TalkCommandError } from "./errors";
import { committed, storeFor } from "./execute";
import type { LearnerStore } from "./store";
import { ask, type TalkDeps } from "./talk-model";
import { partnerRequest } from "./talk-partner";
import { teacherRequest } from "./talk-teacher";
import { turnResultOf, type PartnerReply, type TurnResult } from "./talk-views";

/** A turn the learner sends to one talk. */
export interface SendTurnCommand extends TurnCommand {
  readonly talkId: string;
}

async function readTalk(store: LearnerStore, talkId: string, now: number) {
  const stored = await store.talk(talkId);
  return { stored, live: liveTalk(stored?.value, now) };
}

/**
 * Keeps the next turn: the teacher's and the partner's calls run together, and
 * the turn is kept whatever they produced — `failed` for a teacher that
 * answered nothing, no reply for a partner that did not. A resend of a kept
 * turn answers it without a model call.
 */
export async function sendTurn(
  deps: TalkDeps,
  context: RequestContext,
  command: SendTurnCommand,
): Promise<Result<TurnResult, TalkCommandError>> {
  const bound = storeFor(deps, context, "sendTurn");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  const { live } = await readTalk(store, command.talkId, context.now);
  const decided = decideTurn(live, command);
  if (!decided.ok) {
    return decided;
  }
  if (decided.value.kind === "kept") {
    return ok(turnResultOf(decided.value.turn));
  }
  const { talk, partnerLine, n } = decided.value;
  const [teacher, partner] = await Promise.all([
    ask(deps, teacherRequest({ scene: talk.scene, partnerLine, ...command })),
    ask(deps, partnerRequest(talk, { n, ...command })),
  ]);
  const answers = {
    teacher: teacher.ok ? teacher.value.value : undefined,
    reply: partner.ok ? partner.value.value : undefined,
  };
  return committed(store, async () => {
    const { stored, live: current } = await readTalk(
      store,
      command.talkId,
      context.now,
    );
    const again = decideTurn(current, command);
    if (!again.ok) {
      return again;
    }
    if (again.value.kind === "kept") {
      return ok({ value: turnResultOf(again.value.turn), writes: [] });
    }
    const kept = keepTurn(again.value, command, answers, context.now);
    return ok({
      value: turnResultOf(kept.turn),
      writes: [[{ type: "talk", value: kept.talk }, stored]],
    });
  });
}

/**
 * Asks the partner again for the latest turn's reply, once a turn was kept
 * without one. A reply already kept is answered without a call; a call that
 * fails again is `ERR_MODEL_UNAVAILABLE`.
 */
export async function retryReply(
  deps: TalkDeps,
  context: RequestContext,
  command: { readonly talkId: string },
): Promise<Result<PartnerReply, TalkCommandError>> {
  const bound = storeFor(deps, context, "retryReply");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  const { live } = await readTalk(store, command.talkId, context.now);
  const decided = decideReply(live);
  if (!decided.ok) {
    return decided;
  }
  if (decided.value.kind === "kept") {
    return ok({ line: decided.value.line, closing: decided.value.closing });
  }
  const asked = decided.value.turn;
  const reply = await ask(deps, partnerRequest(decided.value.talk, asked));
  if (!reply.ok) {
    return err(reply.error);
  }
  const line = reply.value.value;
  return committed(store, async () => {
    const { stored, live: current } = await readTalk(
      store,
      command.talkId,
      context.now,
    );
    const again = decideReply(current);
    if (!again.ok) {
      return again;
    }
    if (again.value.kind === "kept") {
      return ok({
        value: { line: again.value.line, closing: again.value.closing },
        writes: [],
      });
    }
    return again.value.turn.n === asked.n
      ? ok({
          value: { line, closing: isClosing(asked) },
          writes: [
            [
              { type: "talk", value: withReply(again.value.talk, asked.n, line) },
              stored,
            ],
          ],
        })
      : err({ code: "ERR_CONFLICT" });
  });
}
