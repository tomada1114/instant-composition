import * as z from "zod";

import { COMPONENTS } from "./components";
import { MESSAGE_BY_CODE, STATUS_BY_CODE, type ErrorCode } from "./errors";
import { roundIdParamSchema } from "./requests";
import { ROUTES, type Route } from "./routes";

type JsonSchema = z.core.JSONSchema.BaseSchema;

interface MediaContent {
  readonly "application/json": { readonly schema: JsonSchema };
}

interface PathParameter {
  readonly name: string;
  readonly in: "path";
  readonly required: true;
  readonly schema: JsonSchema;
}

interface Operation {
  readonly operationId: string;
  readonly summary: string;
  readonly parameters?: readonly PathParameter[];
  readonly requestBody?: { readonly required: true; readonly content: MediaContent };
  readonly responses: Readonly<
    Record<string, { readonly description: string; readonly content?: MediaContent }>
  >;
}

/** The OpenAPI 3.1 document, in the shape this package writes it. */
export interface OpenApiDocument {
  readonly openapi: "3.1.1";
  readonly info: { readonly title: string; readonly version: string };
  readonly servers: readonly { readonly url: string }[];
  readonly paths: Readonly<Record<string, Readonly<Record<string, Operation>>>>;
  readonly components: { readonly schemas: Readonly<Record<string, JsonSchema>> };
}

const COMPONENT_PREFIX = "#/components/schemas/";

/** The schema every `{name}` in a path is validated against. */
const PATH_PARAMETERS: Readonly<Record<string, z.ZodType>> = {
  roundId: roundIdParamSchema,
};

/**
 * `io: "input"` describes what the server accepts, and leaves objects open:
 * an output-mode schema closes every object with `additionalProperties: false`,
 * which would make a generated client reject the fields ADR-0007 lets `/v1`
 * add. The `$schema` and `$id` each converted schema carries are dropped,
 * since a component is placed by its key and the document fixes the dialect.
 */
function placed(schema: JsonSchema): JsonSchema {
  return Object.fromEntries(
    Object.entries(schema).filter(([key]) => key !== "$schema" && key !== "$id"),
  );
}

function jsonSchemaOf(schema: z.ZodType): JsonSchema {
  return placed(z.toJSONSchema(schema, { io: "input" }));
}

function componentSchemas(): Record<string, JsonSchema> {
  const registry = z.registry<{ id: string }>();
  for (const [id, schema] of Object.entries(COMPONENTS)) {
    registry.add(schema, { id });
  }
  const { schemas } = z.toJSONSchema(registry, {
    io: "input",
    uri: (id) => `${COMPONENT_PREFIX}${id}`,
  });
  return Object.fromEntries(
    Object.entries(schemas).map(([id, schema]) => [id, placed(schema)]),
  );
}

const NAMES = new Map<z.ZodType, string>(
  Object.entries(COMPONENTS).map(([id, schema]) => [schema, id]),
);

function json(schema: z.ZodType, where: string): MediaContent {
  const name = NAMES.get(schema);
  if (name === undefined) {
    throw new Error(`${where} names a schema that is not a component.`);
  }
  return { "application/json": { schema: { $ref: `${COMPONENT_PREFIX}${name}` } } };
}

function parametersOf(route: Route): PathParameter[] {
  const names = [...route.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? "");
  return names.map((name) => {
    const schema = PATH_PARAMETERS[name];
    if (schema === undefined) {
      throw new Error(`${route.operationId}'s path names an undeclared parameter.`);
    }
    return { name, in: "path", required: true, schema: jsonSchemaOf(schema) };
  });
}

function errorResponses(route: Route): Operation["responses"] {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of route.errors) {
    const status = STATUS_BY_CODE[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  return Object.fromEntries(
    [...byStatus]
      .sort(([a], [b]) => a - b)
      .map(([status, codes]) => [
        String(status),
        {
          description: codes
            .map((code) => `${code}: ${MESSAGE_BY_CODE[code]}`)
            .join(" "),
          content: json(COMPONENTS.ErrorResponse, route.operationId),
        },
      ]),
  );
}

function operationOf(route: Route): Operation {
  const parameters = parametersOf(route);
  const { status, body } = route.success;
  return {
    operationId: route.operationId,
    summary: route.summary,
    ...(parameters.length === 0 ? {} : { parameters }),
    ...(route.requestBody === null
      ? {}
      : {
          requestBody: {
            required: true,
            content: json(route.requestBody, route.operationId),
          },
        }),
    responses: {
      [String(status)]:
        body === null
          ? { description: "Done; no body." }
          : { description: "OK", content: json(body, route.operationId) },
      ...errorResponses(route),
    },
  };
}

/**
 * The OpenAPI 3.1 document for `routes`, built from zod's own
 * `z.toJSONSchema()` (ADR-0013). Paths are relative to the `/api` server, so a
 * client calls `/api/v1/...` (ADR-0007).
 */
export function openApiDocument(routes: readonly Route[] = ROUTES): OpenApiDocument {
  const paths: Record<string, Record<string, Operation>> = {};
  for (const route of routes) {
    paths[route.path] = { ...paths[route.path], [route.method]: operationOf(route) };
  }
  return {
    openapi: "3.1.1",
    info: { title: "Instant Composition API", version: "1" },
    servers: [{ url: "/api" }],
    paths,
    components: { schemas: componentSchemas() },
  };
}
