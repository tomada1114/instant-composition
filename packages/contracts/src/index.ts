// The HTTP API contract: request and response schemas, and the OpenAPI document built from them.
export { COMPONENTS } from "./components";
export {
  errorResponseSchema,
  MESSAGE_BY_CODE,
  STATUS_BY_CODE,
  type ErrorCode,
} from "./errors";
export { openApiDocument, type OpenApiDocument } from "./openapi";
export {
  answerResultSchema,
  dayKeySchema,
  dotSchema,
  idSchema,
  passSchema,
  roundKindSchema,
  settingsSchema,
  subtopicRefSchema,
} from "./primitives";
export {
  historySchema,
  homeStateSchema,
  homeViewSchema,
  recordsViewSchema,
  settingsPageViewSchema,
  titleGroupSchema,
} from "./query-views";
export {
  answerSchema,
  answersRequestSchema,
  MAX_ROUND_ANSWERS,
  roundIdParamSchema,
  settingsPatchSchema,
  startRoundRequestSchema,
} from "./requests";
export { ROUTES, type Route } from "./routes";
export { roundPayloadSchema, roundSummarySchema, settingsViewSchema } from "./views";
