import {
  TALK_TUNING,
  type Result,
  type Scene,
  type TalkTask,
} from "@instant-composition/domain";

import type {
  AbortSignalLike,
  LanguageModel,
  ModelFailure,
  ModelReply,
  ModelRequest,
} from "./language-model";
import type { LearnerStores } from "./store";

/** What the talk commands are handed besides their context. */
export interface TalkDeps {
  readonly stores: LearnerStores;
  readonly model: LanguageModel;
  /**
   * A signal that aborts `ms` milliseconds from now, bounding one model call.
   * This package has no timers of its own, so the edge supplies it — any
   * `(ms) => AbortSignal.timeout(ms)` will do.
   */
  readonly deadline: (ms: number) => AbortSignalLike;
}

/** A model request for one of the talk's own tasks. */
export interface TalkRequest<T> extends ModelRequest<T> {
  readonly task: TalkTask;
}

/**
 * Each task's prompt version, bumped with any change to its prompt or its
 * output schema; every talk records the versions it ran at.
 */
export const TALK_PROMPTS = {
  "talk-scene": "talk-scene@1",
  "talk-teacher": "talk-teacher@1",
  "talk-partner": "talk-partner@1",
} as const satisfies Record<TalkTask, string>;

/** One model call, bounded by `TALK_TUNING.modelTimeoutMs`. */
export function ask<T>(
  deps: TalkDeps,
  request: TalkRequest<T>,
): Promise<Result<ModelReply<T>, ModelFailure>> {
  return deps.model.generate(request, deps.deadline(TALK_TUNING.modelTimeoutMs));
}

/** `text` as data inside a tag: no text it holds can close the tag or open another. */
export function tagged(tag: string, text: string): string {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<${tag}>${escaped}</${tag}>`;
}

/** The scene as the teacher and the partner are told it, each field delimited. */
export function sceneBlock(scene: Scene): string {
  return [
    "<scene>",
    tagged("partner", scene.partner),
    tagged("place", scene.place),
    tagged("relation", scene.relation),
    tagged("description", scene.description),
    "</scene>",
  ].join("\n");
}

/** What the learner said in a turn: the Japanese, then the English or the give-up. */
export function learnerBlock(japanese: string, english: string | null): string {
  return [
    tagged("japanese", japanese),
    english === null
      ? "The learner gave up on the English."
      : tagged("english", english),
  ].join("\n");
}

/**
 * `value`'s `keys` as strings, trimmed, or `undefined` when `value` is not an
 * object holding a string at each of them and nothing else — the shape its
 * schema states. Length and content rules are the prompt's to keep.
 */
export function textsOf<K extends string>(
  value: unknown,
  keys: readonly K[],
): Readonly<Record<K, string>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const texts = keys.flatMap((key) => {
    const text: unknown = Reflect.get(value, key);
    return typeof text === "string" ? [[key, text.trim()] as const] : [];
  });
  return texts.length === keys.length && Object.keys(value).length === keys.length
    ? (Object.fromEntries(texts) as Record<K, string>)
    : undefined;
}
