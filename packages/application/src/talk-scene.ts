import type { Scene, SceneKind } from "@instant-composition/domain";

import type { JsonSchemaObject } from "./language-model";
import { TALK_PROMPTS, textsOf, type TalkRequest } from "./talk-model";

/** What the scene task answers: the scene in Japanese, the opening line in English. */
export interface SceneAnswer {
  readonly scene: Scene;
  readonly opening: string;
}

const SYSTEM = `You set up a short English conversation practice for a Japanese learner of English. Invent one everyday scene of the kind the message asks for, and the first line the partner says in it.

- Everyday conversation only. Never a specialist topic, never a heavy one such as politics, religion or medicine, and never a trouble that needs a long explanation.
- The partner is a friendly local who is interested in the learner. The learner plays themselves.
- "partner", "place" and "relation" are short Japanese phrases: who the partner is, where the two are, and how they are related.
- "description" is one or two short lines of Japanese that set the scene for the learner.
- "opening" is the partner's first line, in plain spoken English: one or two short sentences, at most one question, no lists, labels or emoji.`;

const KINDS: Readonly<Record<SceneKind, string>> = {
  self: "The kind of scene: the learner talks about themselves — their day, work, hobbies, plans, likes or opinions.",
  errand:
    "The kind of scene: an errand or a small trouble — asking for something, or a small problem in a shop, a station, a restaurant or the neighborhood.",
};

const SCENE_SCHEMA = {
  type: "object",
  properties: {
    partner: { type: "string" },
    place: { type: "string" },
    relation: { type: "string" },
    description: { type: "string" },
    opening: { type: "string" },
  },
  required: ["partner", "place", "relation", "description", "opening"],
  additionalProperties: false,
} as const satisfies JsonSchemaObject;

/** The scene task's output narrowed: every field a string, none of them blank. */
function readScene(value: unknown): SceneAnswer | undefined {
  const texts = textsOf(value, SCENE_SCHEMA.required, SCENE_SCHEMA.required);
  return texts === undefined
    ? undefined
    : {
        scene: {
          partner: texts.partner,
          place: texts.place,
          relation: texts.relation,
          description: texts.description,
        },
        opening: texts.opening,
      };
}

/** The request that makes a scene of `kind`, which the domain drew. */
export function sceneRequest(kind: SceneKind): TalkRequest<SceneAnswer> {
  return {
    task: "talk-scene",
    promptVersion: TALK_PROMPTS["talk-scene"],
    system: SYSTEM,
    messages: [{ role: "user", text: KINDS[kind] }],
    output: { name: "talk_scene", schema: SCENE_SCHEMA, read: readScene },
    temperature: 1,
    maxOutputTokens: 300,
  };
}
