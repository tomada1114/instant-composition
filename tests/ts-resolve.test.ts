import { describe, expect, it } from "vitest";

import { resolveTypeScript } from "../scripts/lib/ts-resolve.mjs";

// The resolve hook `pnpm api` runs the workspace's source through: a relative,
// extensionless import from a `.ts` module Node cannot find is tried once more
// as `.ts`, and nothing else changes.

type Context = Parameters<typeof resolveTypeScript>[1];

const FROM_SOURCE: Context = {
  conditions: ["node", "import"],
  importAttributes: {},
  parentURL: "file:///repo/packages/application/src/index.ts",
};

function notFound(): Error {
  return Object.assign(new Error("Cannot find module"), {
    code: "ERR_MODULE_NOT_FOUND",
  });
}

/** A `nextResolve` that knows only the URLs in `known`, recording what it was asked. */
function resolverOf(known: readonly string[]) {
  const asked: string[] = [];
  const next = (specifier: string): { url: string } => {
    asked.push(specifier);
    if (!known.includes(specifier)) throw notFound();
    return { url: `resolved:${specifier}` };
  };
  return { asked, next };
}

describe("resolveTypeScript", () => {
  it("resolves what Node finds without trying anything else", () => {
    const resolver = resolverOf(["./errors"]);
    expect(resolveTypeScript("./errors", FROM_SOURCE, resolver.next)).toStrictEqual({
      url: "resolved:./errors",
    });
    expect(resolver.asked).toStrictEqual(["./errors"]);
  });

  it.each(["./errors", "../domain/src/day"])(
    "tries %s again as a .ts file when Node cannot find it",
    (specifier) => {
      const resolver = resolverOf([`${specifier}.ts`]);
      expect(resolveTypeScript(specifier, FROM_SOURCE, resolver.next)).toStrictEqual({
        url: `resolved:${specifier}.ts`,
      });
      expect(resolver.asked).toStrictEqual([specifier, `${specifier}.ts`]);
    },
  );

  it.each([
    ["a bare package name", "zod", FROM_SOURCE],
    ["a specifier with an extension", "./errors.js", FROM_SOURCE],
    [
      "an import from JavaScript",
      "./errors",
      { ...FROM_SOURCE, parentURL: "file:///repo/a.mjs" },
    ],
    [
      "an import from a dependency",
      "./errors",
      { ...FROM_SOURCE, parentURL: "file:///repo/node_modules/x/index.ts" },
    ],
    ["an entry point", "./errors", { ...FROM_SOURCE, parentURL: undefined }],
  ])("leaves %s as Node decided", (_, specifier, context) => {
    const resolver = resolverOf([`${specifier}.ts`]);
    expect(() => resolveTypeScript(specifier, context, resolver.next)).toThrow(
      "Cannot find module",
    );
    expect(resolver.asked).toStrictEqual([specifier]);
  });

  it("passes on a failure other than a missing module", () => {
    const failure = Object.assign(new Error("directory import"), {
      code: "ERR_UNSUPPORTED_DIR_IMPORT",
    });
    expect(() =>
      resolveTypeScript("./errors", FROM_SOURCE, () => {
        throw failure;
      }),
    ).toThrow(failure);
  });
});
