import type {
  EndTalkData,
  EndTalkResponses,
  PartnerReply,
  RecordRecitalData,
  RetryReplyData,
  RetryReplyResponses,
  SendTurnData,
  SendTurnResponses,
  StartTalkData,
  StartTalkResponses,
  TalkEnded,
  TalkOpened,
  TurnRequest,
  TurnResult,
} from "../openapi";
import { call, send, type ApiError } from "./api-call";
import type { Result } from "./result";

/** Opens the talk `talkId` names, or answers the talk a start with that id already made. */
export function startTalk(talkId: string): Promise<Result<TalkOpened, ApiError>> {
  return call<StartTalkResponses>("POST", {
    url: "/v1/talks",
    body: { talkId },
  } satisfies StartTalkData);
}

/** Sends one turn's Japanese and English (`null` on a give-up): the judgment, and the reply when it arrived. */
export function sendTurn(
  talkId: string,
  turn: TurnRequest,
): Promise<Result<TurnResult, ApiError>> {
  return call<SendTurnResponses>("POST", {
    url: "/v1/talks/{talkId}/turns",
    path: { talkId },
    body: turn,
  } satisfies SendTurnData);
}

/** Asks again for the partner's reply to the latest turn kept. */
export function retryReply(talkId: string): Promise<Result<PartnerReply, ApiError>> {
  return call<RetryReplyResponses>("POST", {
    url: "/v1/talks/{talkId}/reply",
    path: { talkId },
  } satisfies RetryReplyData);
}

/**
 * Keeps how often the learner looked at turn `turn`'s model answer again.
 * Sent and forgotten: a failed record is dropped rather than shown.
 */
export async function recordRecital(
  talkId: string,
  turn: number,
  revealCount: number,
): Promise<void> {
  try {
    await send("POST", {
      url: "/v1/talks/{talkId}/turns/{turn}/recital",
      path: { talkId, turn },
      body: { revealCount },
    } satisfies RecordRecitalData);
  } catch {
    // Nothing is shown for a recital that was not kept.
  }
}

/** Ends the talk: `kept` says whether it held a turn to keep as a record. */
export function endTalk(talkId: string): Promise<Result<TalkEnded, ApiError>> {
  return call<EndTalkResponses>("POST", {
    url: "/v1/talks/{talkId}/end",
    path: { talkId },
  } satisfies EndTalkData);
}
