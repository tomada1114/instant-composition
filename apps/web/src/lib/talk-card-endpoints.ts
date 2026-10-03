import type {
  AddCardsData,
  AddCardsResponses,
  CardCandidates,
  MakeCandidatesData,
  MakeCandidatesResponses,
} from "../openapi";
import { call, type ApiError } from "./api-call";
import type { Result } from "./result";

/** Generates a kept talk's candidates, or reads those already generated. */
export function makeCandidates(
  talkId: string,
): Promise<Result<CardCandidates, ApiError>> {
  return call<MakeCandidatesResponses>("POST", {
    url: "/v1/talks/{talkId}/candidates",
    path: { talkId },
  } satisfies MakeCandidatesData);
}
/** Adds selected indexes; the returned candidates carry the authoritative status. */
export function addTalkCards(
  talkId: string,
  candidates: readonly number[],
): Promise<Result<CardCandidates, ApiError>> {
  return call<AddCardsResponses>("POST", {
    url: "/v1/talks/{talkId}/cards",
    path: { talkId },
    body: { candidates: [...candidates] },
  } satisfies AddCardsData);
}
