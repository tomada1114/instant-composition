import { createStandInModel, type StandInModel } from "@instant-composition/adapters";
import type {
  LanguageModel,
  RequestContext,
  TalkDeps,
} from "@instant-composition/application";

import { makeHarness, type Harness } from "./application-harness";

// A stand-in model, the in-memory store and a learner for the talk command
// suites. Each task answers from a value a case may change, and answers
// `null` — which every task's `read` refuses — while it is told to fail.

export const SCENE = {
  partner: "近所の人",
  place: "マンションのエレベーター",
  relation: "初対面の隣人",
  description: "引っ越してきたばかりのあなたに、隣人が話しかけてきた。",
  opening: "Hi! Are you new around here?",
};

export const JUDGMENT = {
  verdict: "corrected",
  modelAnswer: "I just moved here last week.",
  point: "「引っ越してきた」→ just moved here",
};

export interface TalkHarness extends Harness {
  readonly model: StandInModel;
  readonly talkDeps: TalkDeps;
  /** Every bound the commands asked a deadline for, in milliseconds. */
  readonly deadlines: number[];
  /** Tasks whose next calls answer what no `read` accepts. */
  readonly failing: Set<string>;
  /** What the scene and the teacher answer while they are not failing. */
  scene: unknown;
  teacher: unknown;
  /** The partner's line while set, in place of the numbered one. */
  partnerLine: string | undefined;
  context(now?: number): RequestContext;
  /** The same deps over another model, such as one that races a write in. */
  withModel(model: LanguageModel): TalkDeps;
}

export function makeTalkHarness(): TalkHarness {
  const base = makeHarness();
  const failing = new Set<string>();
  const deadlines: number[] = [];
  const answer = (task: string, value: () => unknown) => () =>
    failing.has(task) ? null : value();
  const harness: TalkHarness = {
    ...base,
    failing,
    deadlines,
    scene: SCENE,
    teacher: JUDGMENT,
    partnerLine: undefined,
    model: createStandInModel({
      "talk-scene": answer("talk-scene", () => harness.scene),
      "talk-teacher": answer("talk-teacher", () => harness.teacher),
      // The partner numbers its line by the messages it was sent, so a reply
      // shows which turn it answered.
      "talk-partner": (request) =>
        failing.has("talk-partner")
          ? null
          : {
              line:
                harness.partnerLine ??
                `Reply after ${String(request.messages.length)} messages.`,
            },
    }),
    get talkDeps() {
      return harness.withModel(harness.model);
    },
    withModel: (model) => ({
      stores: base.stores,
      model,
      deadline: (ms) => {
        deadlines.push(ms);
        return new AbortController().signal;
      },
    }),
  };
  return harness;
}

/** The tasks the stand-in was asked for, in order. */
export function tasksOf(model: StandInModel): string[] {
  return model.requests.map((request) => request.task);
}
