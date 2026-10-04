import {
  awsRegion,
  envReader,
  invalidVariables,
  tableName,
  text,
  type Source,
} from "./env-values";

export interface ReadModelEnv {
  readonly region: string;
  readonly tableName: string;
  readonly catalogPath: string;
}

export function readModelEnv(source: Source): ReadModelEnv {
  const reader = envReader(source);
  const region = reader.required("AWS_REGION", awsRegion);
  const table = reader.required("API_TABLE_NAME", tableName);
  const catalogPath = reader.required("API_CATALOG_PATH", text);
  if (
    reader.invalid.length !== 0 ||
    region === undefined ||
    table === undefined ||
    catalogPath === undefined
  )
    throw invalidVariables(reader.invalid);
  return { region, tableName: table, catalogPath };
}
