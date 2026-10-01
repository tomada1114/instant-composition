// The talk model's settings, read by ./env's two readers from the variables
// they were handed. Nothing here reads `process.env`.
import type { HostedModelSettings, LocalModelSettings } from "./env-settings";
import {
  apiKey,
  blank,
  modelId,
  modelProvider,
  parameterName,
  type EnvReader,
  type Source,
} from "./env-values";

/** The model a talk asks for when `API_MODEL_ID` is unset on a local run. */
export const DEFAULT_MODEL_ID = "anthropic/claude-haiku-4.5";

/** The local run's model names: both optional. */
export const LOCAL_MODEL_NAMES = ["API_OPENROUTER_API_KEY", "API_MODEL_ID"] as const;

/** The hosted entry's model names; `API_OPENROUTER_API_KEY` only to refuse it. */
export const HOSTED_MODEL_NAMES = [
  "API_MODEL_PROVIDER",
  "API_MODEL_ID",
  "API_OPENROUTER_KEY_PARAMETER",
  "API_OPENROUTER_API_KEY",
] as const;

/** OpenRouter when `API_OPENROUTER_API_KEY` is set, at `API_MODEL_ID` or the default; the stand-in otherwise. */
export function localModelSettings({ read }: EnvReader): LocalModelSettings {
  const key = read("API_OPENROUTER_API_KEY", apiKey);
  const id = read("API_MODEL_ID", modelId) ?? DEFAULT_MODEL_ID;
  return key === undefined
    ? { provider: "stand-in" }
    : { provider: "openrouter", modelId: id, apiKey: key };
}

/**
 * The provider, the model and the key's parameter, every one required, or
 * `undefined` once `reader` has named each that is missing or refused. The
 * key as a plain variable is refused: it enters through the extension alone.
 */
export function hostedModelSettings(
  source: Source,
  { required, invalid }: EnvReader,
): HostedModelSettings | undefined {
  const provider = required("API_MODEL_PROVIDER", modelProvider);
  const id = required("API_MODEL_ID", modelId);
  const keyParameter = required("API_OPENROUTER_KEY_PARAMETER", parameterName);
  if (!blank(source, "API_OPENROUTER_API_KEY")) {
    invalid.push("API_OPENROUTER_API_KEY");
  }
  return provider === undefined || id === undefined || keyParameter === undefined
    ? undefined
    : { provider, modelId: id, keyParameter };
}
