import type { z } from "zod";
import type { Entry } from "@instant-composition/application";
import type { StorageFamily } from "./storage-schema";
import { compositionSchemas } from "./storage-composition";
import { talkSchema, vocabularySchemas } from "./storage-vocabulary";
import { modelTaskSchema } from "./storage-model-task";
import { readModelSchemas } from "./storage-projections";
import { compositionReadModelSchemas } from "./storage-calendar";
import { readModelBootstrapSchema } from "./storage-bootstrap-schema";

type WireCompatible<T> = T extends readonly (infer V)[]
  ? readonly WireCompatible<V>[]
  : T extends object
    ? {
        readonly [K in keyof T]:
          WireCompatible<T[K]> | (undefined extends T[K] ? undefined : never);
      }
    : T;
type FamilyValue<K extends StorageFamily> = K extends "identity"
  ? { readonly learnerId: string }
  : K extends "stats"
    ? Omit<Extract<Entry, { type: "stats" }>["value"], "completedDays"> & {
        readonly completedDays?: readonly string[];
        readonly streak?: { readonly schema: 1; readonly longest: number };
      }
    : K extends Entry["type"]
      ? Extract<Entry, { type: K }>["value"]
      : unknown;
type StorageSchemas = {
  readonly [K in StorageFamily]: z.ZodType<WireCompatible<FamilyValue<K>>>;
};

/** The envelope selects its declared history; the active family gate stays outside. */
export function storageSchemasAt(schemaVersion: number): StorageSchemas {
  return {
    readModelBootstrap: readModelBootstrapSchema(),
    ...compositionSchemas(true, schemaVersion),
    ...vocabularySchemas(true),
    talk: talkSchema(true),
    modelTask: modelTaskSchema(true),
    ...readModelSchemas(true),
    ...compositionReadModelSchemas(true),
  } satisfies StorageSchemas;
}
