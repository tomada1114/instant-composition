import { readFile } from "node:fs/promises";

import {
  catalogSnapshotOf,
  type Catalog,
  type CatalogSnapshot,
  type CatalogUnreadable,
} from "@instant-composition/application";
import { err, ok, type Result } from "@instant-composition/domain";

import { parseCatalogDocument } from "./catalog-schema";

type Read = Result<CatalogSnapshot, CatalogUnreadable>;

const MISSING: Read = err({ code: "ERR_CONTENT_UNREADABLE", reason: "missing" });
const MALFORMED: Read = err({ code: "ERR_CONTENT_UNREADABLE", reason: "malformed" });

async function load(file: string): Promise<Read> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return MISSING;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return MALFORMED;
  }
  const document = parseCatalogDocument(json);
  return document === undefined
    ? MALFORMED
    : ok(catalogSnapshotOf(document, document.l1));
}

/**
 * The catalog one language-pair snapshot serves: `file` is a
 * `dist/catalog/<target>/<l1>.json` that `pnpm catalog:build` wrote, resolved
 * for the first language it was built for.
 *
 * @remarks
 * The file is read and validated once for the catalog's lifetime — once per
 * process when the process builds one catalog — and every caller shares that
 * read. A missing or malformed file is `ERR_CONTENT_UNREADABLE`, never a
 * throw, with a `reason` telling the two apart, and is not remembered: the next call reads again, so a snapshot
 * built after the process started is picked up without a restart.
 */
export function snapshotCatalog(file: string): Catalog {
  let read: Promise<Read> | undefined;
  return {
    snapshot() {
      read ??= load(file).then((result) => {
        if (!result.ok) {
          read = undefined;
        }
        return result;
      });
      return read;
    },
  };
}
