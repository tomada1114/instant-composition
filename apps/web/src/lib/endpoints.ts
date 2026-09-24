import type {
  Answer,
  FinishRoundData,
  FinishRoundResponses,
  GetHomeData,
  GetHomeResponses,
  HomeView,
  RecordAnswersData,
  RoundPayload,
  RoundSummary,
  SettingsPatch,
  SettingsView,
  StartRoundData,
  StartRoundRequest,
  StartRoundResponses,
  UpdateSettingsData,
  UpdateSettingsResponses,
} from "../openapi";
import { err, ok, type Result } from "./result";

/**
 * The API's root on the SPA's own origin (ADR-0008): `openapi.json`'s
 * `servers` entry, which the Vite dev server proxies to the local API.
 */
export const API_ROOT = "/api";

/** An error code from the API, or `ERR_NETWORK` when no readable answer came back. */
export interface ApiError {
  readonly code: string;
}

const NETWORK: ApiError = { code: "ERR_NETWORK" };

/** What became of one send: delivered, refused for good, or worth retrying. */
export type SendOutcome = "sent" | "rejected" | "failed";

/**
 * The shape every generated `<Operation>Data` type has: the path template,
 * what fills it, and the body.
 *
 * @remarks
 * Each call below checks what it sends against its operation's generated
 * `Data` type and reads the answer as its `Responses` type, so the template,
 * the body and the answer are the contract's rather than strings and casts
 * written here.
 */
interface OperationData {
  readonly url: string;
  readonly path?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

type Method = "GET" | "POST" | "PATCH";

/** `data.url` under {@link API_ROOT}, each `{name}` filled with its encoded path parameter. */
export function operationUrl(data: OperationData): string {
  const filled = data.url.replace(/\{(\w+)\}/gu, (_, name: string) =>
    encodeURIComponent(data.path?.[name] ?? ""),
  );
  return `${API_ROOT}${filled}`;
}

function send(method: Method, data: OperationData): Promise<Response> {
  return fetch(
    operationUrl(data),
    data.body === undefined
      ? { method }
      : {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data.body),
        },
  );
}

/** The envelope's `error.code`, or `undefined` for a body that is not the envelope. */
function errorCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return undefined;
  }
  const { error } = body;
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

/** Reads a JSON answer: the body on success, the API's error code otherwise. */
async function call<TResponses extends { 200: unknown }>(
  method: Method,
  data: OperationData,
): Promise<Result<TResponses[200], ApiError>> {
  try {
    const response = await send(method, data);
    const body: unknown = await response.json();
    if (response.ok) return ok(body as TResponses[200]);
    const code = errorCode(body);
    return err(code === undefined ? NETWORK : { code });
  } catch {
    return err(NETWORK);
  }
}

export function getHome(): Promise<Result<HomeView, ApiError>> {
  return call<GetHomeResponses>("GET", { url: "/v1/home" } satisfies GetHomeData);
}

export function updateSettings(
  patch: SettingsPatch,
): Promise<Result<SettingsView, ApiError>> {
  return call<UpdateSettingsResponses>("PATCH", {
    url: "/v1/settings",
    body: patch,
  } satisfies UpdateSettingsData);
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
