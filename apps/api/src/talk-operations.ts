import {
  addCards,
  endTalk,
  makeCandidates,
  recordRecital,
  retryReply,
  sendTurn,
  startTalk,
  type RequestContext,
  type TalkCommandError,
} from "@instant-composition/application";
import {
  addCardsRequestSchema,
  recitalRequestSchema,
  startTalkRequestSchema,
  turnRequestSchema,
} from "@instant-composition/contracts";
import { err, type Result } from "@instant-composition/domain";

import type {
  BodySchema,
  Operation,
  OperationDeps,
  Outcome,
  PathParam,
  PathValues,
} from "./operations";

type TalkRun<A extends unknown[]> = (
  deps: OperationDeps,
  context: RequestContext,
  path: PathValues,
  ...args: A
) => Promise<Result<unknown, TalkCommandError>>;

/**
 * A talk command's refusal as the contract answers it: the code alone. A
 * model failure's `reason` is the model-call line's, never the response's or
 * the request line's.
 */
async function answered(
  result: Promise<Result<unknown, TalkCommandError>>,
): Promise<Outcome> {
  const settled = await result;
  return settled.ok ? settled : err({ code: settled.error.code });
}

/** A talk operation whose route takes no body. */
function talkAction(params: readonly PathParam[], run: TalkRun<[]>): Operation {
  return {
    body: null,
    params,
    handle: ({ deps, context, path }) => answered(run(deps, context, path)),
  };
}

/** A talk operation validating its body with the route's own schema. */
function talkCommand<T>(
  schema: BodySchema<T>,
  params: readonly PathParam[],
  run: TalkRun<[body: T]>,
): Operation {
  return {
    body: schema,
    params,
    async handle({ deps, context, path, body }) {
      const parsed = schema.safeParse(body);
      return parsed.success
        ? answered(run(deps, context, path, parsed.data))
        : err({ code: "ERR_BAD_REQUEST" });
    },
  };
}

/** The talk activity's operations, keyed by `operationId`; the talk id comes from the path. */
export const TALK_OPERATIONS: Readonly<Record<string, Operation>> = {
  startTalk: talkCommand(startTalkRequestSchema, [], (deps, context, _, start) =>
    startTalk(deps, context, start),
  ),
  sendTurn: talkCommand(turnRequestSchema, ["talkId"], (deps, context, path, turn) =>
    sendTurn(deps, context, { ...turn, talkId: path.talkId }),
  ),
  retryReply: talkAction(["talkId"], (deps, context, { talkId }) =>
    retryReply(deps, context, { talkId }),
  ),
  recordRecital: talkCommand(
    recitalRequestSchema,
    ["talkId", "turn"],
    (deps, context, { talkId, turn }, { revealCount }) =>
      recordRecital(deps, context, { talkId, turn, revealCount }),
  ),
  endTalk: talkAction(["talkId"], (deps, context, { talkId }) =>
    endTalk(deps, context, { talkId }),
  ),
  makeCandidates: talkAction(["talkId"], (deps, context, { talkId }) =>
    makeCandidates(deps, context, { talkId }),
  ),
  addCards: talkCommand(
    addCardsRequestSchema,
    ["talkId"],
    (deps, context, { talkId }, { candidates }) =>
      addCards(deps, context, { talkId, candidates }),
  ),
};
