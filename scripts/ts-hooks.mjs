// `node --import ./scripts/ts-hooks.mjs <entry>.ts`: registers the resolve hook
// in scripts/lib/ts-resolve.mjs, so Node runs the workspace's TypeScript
// source straight from disk — no build step, no loader dependency. `pnpm api`
// starts the API through it.
import { registerHooks } from "node:module";

import { resolveTypeScript } from "./lib/ts-resolve.mjs";

registerHooks({ resolve: resolveTypeScript });
