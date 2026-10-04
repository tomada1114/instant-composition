import type {
  CompositionBuild,
  CompositionCandidate,
  CompositionReadModel,
} from "@instant-composition/application";

export function makeCompositionReadModel(): CompositionReadModel {
  return {
    schema: 1,
    generation: "fixture",
    day: "2026-09-22",
    epoch: 1,
    catalogVersion: "fixture",
    settingsVersion: 1,
    statsVersion: 1,
    portionVersion: 1,
    tallyVersion: 1,
    available: 0,
    preview: null,
    reach: {},
    breakdown: {},
    pending: 0,
    weak: { grammar: [], subtopics: [] },
  };
}
export function makeCompositionBuild(): CompositionBuild {
  const model = makeCompositionReadModel();
  return {
    schema: 1,
    generation: "fixture",
    day: model.day,
    epoch: 1,
    catalogVersion: "fixture",
    settingsVersion: 1,
    statsVersion: 1,
    portionVersion: 1,
    tallyVersion: 1,
    phase: "items",
    cursor: null,
    known: "",
    answered: 0,
    newAnswered: 0,
    due: 0,
    notDue: 0,
    notDueTop: [],
    conceptFirst: {},
    notDueConceptFirst: {},
    notDueConceptRanks: {},
    conceptRanks: {},
    concepts: {},
    subtopics: {},
    reach: {},
    breakdown: {},
    pending: 0,
  };
}

export function makeCompositionCandidate(
  overrides: Partial<CompositionCandidate> = {},
): CompositionCandidate {
  return {
    schema: 1,
    day: "2026-09-22",
    generation: "fixture",
    mode: "due",
    order: "00001",
    id: "c1",
    scheduled: true,
    recall: 0.5,
    at: 0,
    ...overrides,
  };
}
