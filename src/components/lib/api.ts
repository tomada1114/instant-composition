import type { SettingsPatch } from "../../core/api";
import { err, ok, type Result } from "../../core/result";
import type { SettingsView } from "../../core/views";

/** An error code from the API, or `ERR_NETWORK` when no readable answer came back. */
export interface ApiError {
  readonly code: string;
  readonly available?: number;
}

const NETWORK: ApiError = { code: "ERR_NETWORK" };

/** Sends `body` as JSON with `method`; the answer is the caller's to read. */
export function sendJson(
  path: string,
  body: unknown,
  method: "POST" | "PUT" = "POST",
): Promise<Response> {
  return fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Reads a JSON answer: the body on success, the API's error otherwise. */
export async function readJson<T>(
  request: Promise<Response>,
): Promise<Result<T, ApiError>> {
  try {
    const response = await request;
    const body = (await response.json()) as unknown;
    if (response.ok) return ok(body as T);
    const error = (body as { error?: ApiError } | null)?.error;
    return err(error?.code === undefined ? NETWORK : error);
  } catch {
    return err(NETWORK);
  }
}

export function saveSettings(
  patch: SettingsPatch,
): Promise<Result<SettingsView, ApiError>> {
  return readJson(sendJson("/api/settings", patch, "PUT"));
}
