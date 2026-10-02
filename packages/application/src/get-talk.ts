import {
  err,
  isClosing,
  liveTalk,
  ok,
  type Result,
  type TalkError,
} from "@instant-composition/domain";

import type { RequestContext } from "./context";
import type { ApplicationError } from "./errors";
import { storeFor } from "./execute";
import type { LearnerStores } from "./store";
import { openedOf, type TalkView } from "./talk-views";

/** Reads the learner's own unexpired talk without a model call or a write. */
export async function getTalk(
  deps: { readonly stores: LearnerStores },
  context: RequestContext,
  talkId: string,
): Promise<Result<TalkView, ApplicationError | TalkError>> {
  const bound = storeFor(deps, context, "getTalk");
  if (!bound.ok) return bound;
  const stored = await bound.value.talk(talkId);
  const talk = liveTalk(stored?.value, context.now);
  if (talk === undefined) return err({ code: "ERR_TALK_NOT_FOUND" });
  return ok({
    ...openedOf(talk),
    status: talk.status,
    turns: talk.turns.map((turn) => ({
      turn: turn.n,
      japanese: turn.japanese,
      english: turn.english,
      judgment: turn.judgment,
      reply: turn.reply ?? null,
      closing: isClosing(turn),
    })),
  });
}
