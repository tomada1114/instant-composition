import {
  createOpenRouterModel,
  createStandInModel,
  type StandInModel,
} from "@instant-composition/adapters";
import { TALK_TUNING } from "@instant-composition/domain";

import type {
  HostedModelSettings,
  LocalModelSettings,
  ParametersExtension,
} from "./env-settings";
import type { ServedModel } from "./model-log";
import { readSecureString, SecretParameterError } from "./parameters-extension";
import type { Fetch } from "./token-endpoint";

/** Who the stand-in is, as its call record and the start-up line name it. */
const STAND_IN = "stand-in";

/**
 * A stand-in model with an answer for every talk task, so a run with no key and
 * the tests can drive a whole talk: one fixed scene, a correction on every
 * turn, and a partner line naming the turn it answers, the last one closing.
 */
export function standInTalkModel(): StandInModel {
  return createStandInModel({
    "talk-scene": () => ({
      partner: "A neighbor (stand-in model)",
      place: "The building's elevator",
      relation: "Neighbors meeting for the first time",
      description: "The stand-in model sets this scene; no language model was called.",
      opening: "Hi! Are you new around here?",
    }),
    "talk-teacher": () => ({
      verdict: "corrected",
      modelAnswer: "This is the stand-in model's answer.",
      point: "The stand-in model gives no real correction.",
    }),
    // The partner is sent the opening and two messages per earlier turn, then this turn.
    "talk-partner": (request) => {
      const turn = (request.messages.length - 1) / 2;
      return {
        line:
          turn >= TALK_TUNING.turns
            ? "It was nice talking with you. See you around!"
            : `Stand-in reply to turn ${String(turn)}. What else?`,
      };
    },
  });
}

/** The model a local run serves talks with: OpenRouter when a key is set, the stand-in otherwise. */
export function localModel(settings: LocalModelSettings, fetch: Fetch): ServedModel {
  if (settings.provider === "stand-in") {
    return { provider: STAND_IN, modelId: STAND_IN, model: standInTalkModel() };
  }
  const { apiKey, modelId } = settings;
  return {
    provider: "openrouter",
    modelId,
    model: createOpenRouterModel({
      fetch,
      apiKey: () => Promise.resolve(apiKey),
      modelId,
    }),
  };
}

/**
 * The model the hosted entry serves talks with. The key is read through the
 * Parameters and Secrets extension on every call, as the web client's secret
 * is, so the function holds no copy and starts whether or not the parameter
 * exists yet: a call that cannot read it throws `SecretParameterError`.
 */
export function hostedModel(
  settings: HostedModelSettings,
  extension: ParametersExtension,
  fetch: Fetch,
): ServedModel {
  const apiKey = async (): Promise<string> => {
    const key = (
      await readSecureString(extension, settings.keyParameter, fetch)
    ).trim();
    if (key === "") {
      throw new SecretParameterError(null, "the parameter holds no API key");
    }
    return key;
  };
  return {
    provider: settings.provider,
    modelId: settings.modelId,
    model: createOpenRouterModel({ fetch, apiKey, modelId: settings.modelId }),
  };
}
