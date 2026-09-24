// `eslint-plugin-jsx-a11y` publishes no type declarations, and
// `eslint.config.mjs` is type-checked (`checkJs`). This states only the shape
// that file reads: an ESLint plugin object.
declare module "eslint-plugin-jsx-a11y" {
  import type { ESLint } from "eslint";

  const plugin: ESLint.Plugin;
  export default plugin;
}
