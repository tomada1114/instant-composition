import {
  err,
  liveTalk,
  ok,
  openTalk,
  sceneKindOf,
  seededRandom,
  type Result,
} from "@instant-composition/domain";

import type { RequestContext } from "./context";
import type { TalkCommandError } from "./errors";
import { committed, storeFor } from "./execute";
import { TALK_PROMPTS, type TalkDeps } from "./talk-model";
import { askReserved, reserveModels } from "./talk-model-task";
import { sceneRequest } from "./talk-scene";
import { openedOf, type TalkOpened } from "./talk-views";

/**
 * Starts a talk: one scene call, then the talk kept open with its scene and
 * opening line. A resent start with the same talk id answers the talk it made
 * without calling the model again.
 *
 * @remarks
 * The scene's kind is drawn from a random seeded by the talk id, so a resend
 * that races the first start asks for the same kind.
 */
export async function startTalk(
  deps: TalkDeps,
  context: RequestContext,
  command: { readonly talkId: string },
): Promise<Result<TalkOpened, TalkCommandError>> {
  const bound = storeFor(deps, context, "startTalk");
  if (!bound.ok) {
    return bound;
  }
  const store = bound.value;
  const read = async () => {
    const stored = await store.talk(command.talkId);
    return { stored, live: liveTalk(stored?.value, context.now) };
  };
  const before = await read();
  if (before.live !== undefined) {
    return ok(openedOf(before.live));
  }
  const kind = sceneKindOf(seededRandom(`talk:${command.talkId}`));
  const request = sceneRequest(kind);
  const reserved = await reserveModels(
    store,
    context,
    [
      {
        key: {
          talkId: command.talkId,
          task: request.task,
          turn: 0,
          promptVersion: request.promptVersion,
        },
        request,
      },
    ],
    [
      {
        key: { type: "talk", id: command.talkId },
        version: before.stored?.version ?? null,
      },
    ],
  );
  if (!reserved.ok) return reserved;
  const reservation = reserved.value[0];
  if (reservation === undefined) return err({ code: "ERR_CONFLICT" });
  const scene = await askReserved(deps, store, reservation, request);
  if (!scene.ok) {
    return err(scene.error);
  }
  const { call, value } = scene.value;
  const talk = openTalk({
    id: command.talkId,
    now: context.now,
    scene: value.scene,
    opening: value.opening,
    model: { provider: call.provider, modelId: call.modelId, prompts: TALK_PROMPTS },
  });
  return committed(store, async () => {
    const { stored, live } = await read();
    return ok(
      live === undefined
        ? { value: openedOf(talk), writes: [[{ type: "talk", value: talk }, stored]] }
        : { value: openedOf(live), writes: [] },
    );
  });
}
