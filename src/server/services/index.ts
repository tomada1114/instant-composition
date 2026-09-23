import type { AnswerInput, SettingsPatch } from "../../core/api";
import type { Result } from "../../core/result";
import type { RoundKind } from "../../core/types";
import type {
  HomeView,
  RoundPayload,
  RoundSummary,
  SettingsView,
} from "../../core/views";
import { recordAnswer } from "./answer";
import type { ServiceDeps, ServiceError } from "./deps";
import { finishRound } from "./finish";
import { home, recap } from "./home";
import { readProgress } from "./progress";
import { updateSettings } from "./settings";
import { startRound } from "./start";

export type { ServiceDeps, ServiceError, ServiceErrorCode } from "./deps";

/** The shape `pnpm cards:gaps --history` reads. */
export interface History {
  readonly seenIds: readonly string[];
  readonly topics: readonly string[];
  readonly focusSubtopics: readonly string[];
  readonly estimatedLevel: number;
}

export interface Services {
  home(): HomeView;
  recap(): RoundSummary | undefined;
  startRound(kind: RoundKind): Result<RoundPayload, ServiceError>;
  recordAnswer(input: AnswerInput): Result<undefined, ServiceError>;
  finishRound(
    roundId: string,
    answers: readonly AnswerInput[],
  ): Result<RoundSummary, ServiceError>;
  updateSettings(patch: SettingsPatch): Result<SettingsView, ServiceError>;
  history(): History;
}

export function createServices(deps: ServiceDeps): Services {
  return {
    home: () => home(deps),
    recap: () => recap(deps),
    startRound: (kind) => startRound(deps, kind),
    recordAnswer: (input) => recordAnswer(deps, input),
    finishRound: (roundId, answers) => finishRound(deps, roundId, answers),
    updateSettings: (patch) => updateSettings(deps, patch),
    history() {
      const progress = readProgress(deps);
      const seen = new Set(
        progress.answers
          .filter((answer) => answer.pass === "first")
          .map((answer) => answer.cardId),
      );
      return {
        seenIds: [...seen].sort(),
        topics: progress.settings?.topics ?? [],
        focusSubtopics: (progress.settings?.focus ?? []).map(
          (ref) => `${ref.topic}/${ref.subtopic}`,
        ),
        estimatedLevel: progress.level?.level ?? 1,
      };
    },
  };
}
