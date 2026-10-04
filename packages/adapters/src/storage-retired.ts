import { z } from "zod";
import type { StorageFamily } from "./storage-schema";
import { commonSchemas } from "./storage-common";

const mode = z.enum(["typed", "spoken"]);
const mark = commonSchemas(true).mark.extend({ answerMode: mode.optional() });

function retire(value: unknown, fields: z.ZodRawShape): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  // Validate only the explicitly retired keys, retaining every other key for the
  // subsequent strict decoder. A known name with a future shape is not disposable.
  z.object(fields).parse(value);
  return omit(value, Object.keys(fields));
}

function omit(value: unknown, fields: readonly string[]): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !fields.includes(key)),
  );
}

/** Only known, valid obsolete paths are removed; all other keys remain strict. */
export function withoutRetired(type: StorageFamily, value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const read = (key: string): unknown => Reflect.get(value, key);
  switch (type) {
    case "settings":
    case "round":
      return retire(value, { answerMode: mode.optional() });
    case "review":
      return {
        ...value,
        detail: retire(read("detail"), {
          answerMode: mode.optional(),
          text: z.string().max(300).optional(),
        }),
      };
    case "item":
      return {
        ...(retire(value, { otherMode: mark.nullable().optional() }) as object),
        last: retire(read("last"), { answerMode: mode.optional() }),
        previous: retire(read("previous"), { answerMode: mode.optional() }),
      };
    default:
      return value;
  }
}
