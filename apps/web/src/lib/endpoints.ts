import type {
  Answer,
  FinishRoundData,
  FinishRoundResponses,
  GetHomeData,
  GetHomeResponses,
  GetProfileData,
  GetProfileResponses,
  GetRecordsData,
  GetRecordsResponses,
  GetRoundSummaryData,
  GetRoundSummaryResponses,
  GetSettingsData,
  GetSettingsResponses,
  HomeView,
  Profile,
  ProfilePatch,
  RecordAnswersData,
  RecordsView,
  RoundPayload,
  RoundSummary,
  SettingsPageView,
  SettingsPatch,
  SettingsView,
  StartRoundData,
  StartRoundRequest,
  StartRoundResponses,
  UpdateProfileData,
  UpdateProfileResponses,
  UpdateSettingsData,
  UpdateSettingsResponses,
} from "../openapi";
import { call, errorCode, send, type ApiError, type SendOutcome } from "./api-call";
import type { Result } from "./result";

export {
  API_ROOT,
  beginVisit,
  LOGIN_URL,
  LOGOUT_URL,
  REFRESH_URL,
  operationUrl,
  type ApiError,
  type SendOutcome,
} from "./api-call";

export function getHome(): Promise<Result<HomeView, ApiError>> {
  return call<GetHomeResponses>("GET", { url: "/v1/home" } satisfies GetHomeData);
}

/** The settings as saved (the defaults before any), the topics to choose from, and the difficulty. */
export function getSettings(): Promise<Result<SettingsPageView, ApiError>> {
  return call<GetSettingsResponses>("GET", {
    url: "/v1/settings",
  } satisfies GetSettingsData);
}

export function getRecords(): Promise<Result<RecordsView, ApiError>> {
  return call<GetRecordsResponses>("GET", {
    url: "/v1/records",
  } satisfies GetRecordsData);
}

/** The summary the round `roundId` kept when it finished; `ERR_ROUND_NOT_FOUND` for one not finished. */
export function getRoundSummary(
  roundId: string,
): Promise<Result<RoundSummary, ApiError>> {
  return call<GetRoundSummaryResponses>("GET", {
    url: "/v1/rounds/{roundId}/summary",
    path: { roundId },
  } satisfies GetRoundSummaryData);
}

export function updateSettings(
  patch: SettingsPatch,
): Promise<Result<SettingsView, ApiError>> {
  return call<UpdateSettingsResponses>("PATCH", {
    url: "/v1/settings",
    body: patch,
  } satisfies UpdateSettingsData);
}

/** The learner's profile: the time zone the practice day is counted in, and the languages. */
export function getProfile(): Promise<Result<Profile, ApiError>> {
  return call<GetProfileResponses>("GET", { url: "/v1/me" } satisfies GetProfileData);
}

/** Changes the profile fields `patch` sets; `ERR_BAD_REQUEST` for a value the API does not serve. */
export function updateProfile(patch: ProfilePatch): Promise<Result<Profile, ApiError>> {
  return call<UpdateProfileResponses>("PATCH", {
    url: "/v1/me",
    body: patch,
  } satisfies UpdateProfileData);
}

/** Starts the round `request` names, or answers the round a start with its id already made. */
export function startRound(
  request: StartRoundRequest,
): Promise<Result<RoundPayload, ApiError>> {
  return call<StartRoundResponses>("POST", {
    url: "/v1/rounds",
    body: request,
  } satisfies StartRoundData);
}

export function finishRound(
  roundId: string,
  answers: readonly Answer[],
): Promise<Result<RoundSummary, ApiError>> {
  return call<FinishRoundResponses>("POST", {
    url: "/v1/rounds/{roundId}/finish",
    path: { roundId },
    body: { answers: [...answers] },
  } satisfies FinishRoundData);
}

/**
 * Sends a batch of answers. A refusal is final — resending the same request
 * changes nothing — except `ERR_CONFLICT`, which the contract names as the
 * one worth sending again, and a 5xx or no answer at all.
 */
export async function recordAnswers(
  roundId: string,
  answers: readonly Answer[],
): Promise<SendOutcome> {
  const data: RecordAnswersData = {
    url: "/v1/rounds/{roundId}/answers",
    path: { roundId },
    body: { answers: [...answers] },
  };
  try {
    const response = await send("POST", data);
    if (response.ok) return "sent";
    if (response.status >= 500) return "failed";
    const code = errorCode(await response.json().catch(() => null));
    return code === "ERR_CONFLICT" ? "failed" : "rejected";
  } catch {
    return "failed";
  }
}
