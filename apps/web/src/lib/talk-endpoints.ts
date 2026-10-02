import type {
  GetTalkData,
  GetTalkResponses,
  TalkView,
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
import { call, errorCode, send, type ApiError, type OperationData } from "./api-call";
import type { Result } from "./result";
import { forgetTalk } from "./talk-storage";

async function talkCall<T extends { 200: unknown }>(
  method: "GET" | "POST",
  data: OperationData,
): Promise<Result<T[200], ApiError>> {
  const result = await call<T>(method, data);
  const talkId = data.path?.["talkId"];
  if (
    !result.ok &&
    result.error.code === "ERR_TALK_NOT_FOUND" &&
    typeof talkId === "string"
  )
    forgetTalk(talkId);
  return result;
}

/** Reads this learner's own talk and kept turns without a model call. */
export function getTalk(talkId: string): Promise<Result<TalkView, ApiError>> {
  return talkCall<GetTalkResponses>("GET", {
    url: "/v1/talks/{talkId}",
    path: { talkId },
  } satisfies GetTalkData);
}

/** Opens the talk `talkId` names, or answers the talk a start with that id already made. */
export function startTalk(talkId: string): Promise<Result<TalkOpened, ApiError>> {
  return talkCall<StartTalkResponses>("POST", {
    url: "/v1/talks",
    body: { talkId },
  } satisfies StartTalkData);
}

/** Sends one turn's Japanese and English (`null` on a give-up): the judgment, and the reply when it arrived. */
export function sendTurn(
  talkId: string,
  turn: TurnRequest,
): Promise<Result<TurnResult, ApiError>> {
  return talkCall<SendTurnResponses>("POST", {
    url: "/v1/talks/{talkId}/turns",
    path: { talkId },
    body: turn,
  } satisfies SendTurnData);
}

/** Asks again for the partner's reply to the latest turn kept. */
export function retryReply(talkId: string): Promise<Result<PartnerReply, ApiError>> {
  return talkCall<RetryReplyResponses>("POST", {
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
    const response = await send("POST", {
      url: "/v1/talks/{talkId}/turns/{turn}/recital",
      path: { talkId, turn },
      body: { revealCount },
    } satisfies RecordRecitalData);
    if (!response.ok && errorCode(await response.json()) === "ERR_TALK_NOT_FOUND")
      forgetTalk(talkId);
  } catch {
    // Nothing is shown for a recital that was not kept.
  }
}

/** Ends the talk: `kept` says whether it held a turn to keep as a record. */
export function endTalk(talkId: string): Promise<Result<TalkEnded, ApiError>> {
  return talkCall<EndTalkResponses>("POST", {
    url: "/v1/talks/{talkId}/end",
    path: { talkId },
  } satisfies EndTalkData);
}
