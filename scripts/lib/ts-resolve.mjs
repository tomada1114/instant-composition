// The resolve hook that lets Node run this workspace's TypeScript source with
// its built-in type stripping, and nothing more.
//
// The packages import each other's modules without an extension (`./errors`),
// the way a bundler resolves them (`moduleResolution: "bundler"`); Node's ESM
// resolver wants the file name exactly. So a relative import from a `.ts`
// module that Node cannot find is tried once more with `.ts` appended. Every
// other specifier, and every failure of another kind, is left exactly as Node
// decided it.

/** @typedef {import("node:module").ResolveHookContext} ResolveHookContext */
/** @typedef {import("node:module").ResolveFnOutput} ResolveFnOutput */
/** @typedef {(specifier: string, context?: Partial<ResolveHookContext>) => ResolveFnOutput} NextResolve */

/**
 * Whether `specifier`, imported from `parentURL`, is a workspace module's
 * extensionless relative import.
 *
 * @param {string} specifier
 * @param {string | undefined} parentURL
 * @returns {boolean}
 */
function isExtensionlessRelative(specifier, parentURL) {
  return (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\.[cm]?[jt]sx?$/.test(specifier) &&
    parentURL !== undefined &&
    parentURL.endsWith(".ts") &&
    !parentURL.includes("/node_modules/")
  );
}

/**
 * A synchronous `resolve` hook for `module.registerHooks`.
 *
 * @param {string} specifier
 * @param {ResolveHookContext} context
 * @param {NextResolve} nextResolve
 * @returns {ResolveFnOutput}
 */
export function resolveTypeScript(specifier, context, nextResolve) {
  try {
    return nextResolve(specifier, context);
  } catch (error) {
    const notFound =
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_MODULE_NOT_FOUND";
    if (!notFound || !isExtensionlessRelative(specifier, context.parentURL)) {
      throw error;
    }
    return nextResolve(`${specifier}.ts`, context);
  }
}
