import {
  decideEnd,
  decideRecital,
  liveTalk,
  ok,
  type Result,
} from "@instant-composition/domain";

import type { RequestContext } from "./context";
import type { TalkCommandError } from "./errors";
import { committed, storeFor } from "./execute";
import type { TalkDeps } from "./talk-model";
import type { TalkEnded } from "./talk-views";

/** How often the learner looked at a turn's model answer again while reciting it. */
export interface RecitalCommand {
  readonly talkId: string;
  readonly turn: number;
  readonly revealCount: number;
}

/**
 * Keeps a turn's reveal count. Sending the same count again writes nothing,
 * so the client may send it and forget it.
 */
export async function recordRecital(
  deps: Pick<TalkDeps, "stores">,
  context: RequestContext,
  command: RecitalCommand,
): Promise<Result<undefined, TalkCommandError>> {
  const bound = storeFor(deps, context, "recordRecital");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  return committed(store, async () => {
    const stored = await store.talk(command.talkId);
    const decided = decideRecital(liveTalk(stored?.value, context.now), command);
    if (!decided.ok) {
      return decided;
    }
    return ok({
      value: undefined,
      writes:
        decided.value === stored?.value
          ? []
          : [[{ type: "talk", value: decided.value }, stored]],
    });
  });
}

/**
 * Ends a talk: kept as a record when it holds a turn, discarded to expire when
 * it holds none. Ending it again answers the same `kept`.
 */
export async function endTalk(
  deps: Pick<TalkDeps, "stores">,
  context: RequestContext,
  command: { readonly talkId: string },
): Promise<Result<TalkEnded, TalkCommandError>> {
  const bound = storeFor(deps, context, "endTalk");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  return committed(store, async () => {
    const stored = await store.talk(command.talkId);
    const talk = liveTalk(stored?.value, context.now);
    const decided = decideEnd(talk, context.now);
    if (!decided.ok) {
      return decided;
    }
    const { kept } = decided.value;
    return ok({
      value: { kept },
      writes:
        decided.value.talk === talk
          ? []
          : [[{ type: "talk", value: decided.value.talk }, stored]],
    });
  });
}
