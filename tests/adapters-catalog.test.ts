import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { snapshotCatalog } from "@instant-composition/adapters";

import { buildCatalog } from "../scripts/catalog/build.mjs";
import { DEFAULT_ROOT } from "../scripts/cards/store.mjs";

// The catalog adapter over the file `pnpm catalog:build` writes, built from
// the real content/ into a temporary directory: nothing here writes under the
// repository.

const MISSING = {
  ok: false,
  error: { code: "ERR_CONTENT_UNREADABLE", reason: "missing" },
};
const MALFORMED = {
  ok: false,
  error: { code: "ERR_CONTENT_UNREADABLE", reason: "malformed" },
};

let out = "";
let file = "";

beforeEach(() => {
  out = mkdtempSync(path.join(tmpdir(), "adapters-catalog-"));
  file = path.join(out, "en", "ja.json");
});

afterEach(() => {
  rmSync(out, { recursive: true, force: true });
});

/** The built snapshot as parsed JSON, to edit into a malformed one. */
function built(): Record<string, unknown> {
  buildCatalog({ root: DEFAULT_ROOT, out });
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

describe("snapshotCatalog", () => {
  it("serves the snapshot pnpm catalog:build wrote, for the first language it was built for", async () => {
    const document = built();
    const items = document["items"] as { id: string }[];

    const read = await snapshotCatalog(file).snapshot();

    if (!read.ok) {
      throw new Error("The built snapshot was not readable.");
    }
    expect(read.value.version).toBe(document["version"]);
    expect([...read.value.shown.keys()].sort()).toStrictEqual(
      items.map((item) => item.id).sort(),
    );
    expect(read.value.levels.get(1)).toStrictEqual({ cefr: "A1+", toeic: "300" });
    expect(read.value.topics.map((topic) => topic.name)).toContain("日常");
  });

  it("answers ERR_CONTENT_UNREADABLE with reason missing for a missing file", async () => {
    expect(await snapshotCatalog(file).snapshot()).toStrictEqual(MISSING);
  });

  it("answers ERR_CONTENT_UNREADABLE with reason unreadable for a path that cannot be read", async () => {
    mkdirSync(file, { recursive: true });

    expect(await snapshotCatalog(file).snapshot()).toStrictEqual({
      ok: false,
      error: { code: "ERR_CONTENT_UNREADABLE", reason: "unreadable" },
    });
  });

  it("answers ERR_CONTENT_UNREADABLE with reason malformed for a file that is not JSON", async () => {
    built();
    writeFileSync(file, "{ not json");

    expect(await snapshotCatalog(file).snapshot()).toStrictEqual(MALFORMED);
  });

  it.each<[string, (document: Record<string, unknown>) => unknown]>([
    ["a newer format", (document) => ({ ...document, format: 2 })],
    [
      "no items",
      (document) =>
        Object.fromEntries(Object.entries(document).filter(([key]) => key !== "items")),
    ],
    ["a version that is not a sha256", (document) => ({ ...document, version: "v1" })],
    [
      "an item whose level is not a whole number",
      (document) => ({
        ...document,
        items: (document["items"] as Record<string, unknown>[]).map((item, index) =>
          index === 0 ? { ...item, level: "5" } : item,
        ),
      }),
    ],
    ["an array", () => []],
    ["a bare string", () => "catalog"],
  ])(
    "answers ERR_CONTENT_UNREADABLE with reason malformed for %s",
    async (_, malform) => {
      writeFileSync(file, JSON.stringify(malform(built())));

      expect(await snapshotCatalog(file).snapshot()).toStrictEqual(MALFORMED);
    },
  );

  it("reads the file once and serves every later call from that read", async () => {
    built();
    const catalog = snapshotCatalog(file);
    const [first, concurrent] = await Promise.all([
      catalog.snapshot(),
      catalog.snapshot(),
    ]);
    writeFileSync(file, "{ not json");

    const later = await catalog.snapshot();

    expect(first.ok).toBe(true);
    expect(concurrent).toBe(first);
    expect(later).toBe(first);
  });

  it("reads again after a failure, so a snapshot built later is picked up", async () => {
    const catalog = snapshotCatalog(file);
    expect(await catalog.snapshot()).toStrictEqual(MISSING);

    built();

    expect((await catalog.snapshot()).ok).toBe(true);
  });
});
