import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// `pnpm api` runs apps/api's TypeScript source on Node's own type stripping,
// through scripts/ts-hooks.mjs. This loads the API's whole module graph —
// every workspace package it reaches — the same way, so a module Node cannot
// strip (an `enum`, a parameter property) or an import the hook cannot resolve
// fails here rather than at the first local run. DynamoDB is never touched:
// only `main.ts` connects, and it is not loaded. The hosted entry, `lambda.ts`,
// is loaded too, in a process given only the environment each case names: it
// builds its DynamoDB client and sends nothing until an event arrives.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** The hosted entry's whole environment; none of these is a real value. */
const HOSTED = {
  AWS_REGION: "ap-northeast-1",
  AWS_SESSION_TOKEN: "session-token-for-tests",
  API_TABLE_NAME: "instant-composition-dev",
  API_CATALOG_PATH: "catalog/en/ja.json",
  API_COGNITO_USER_POOL_ID: "ap-northeast-1_AbC123",
  API_COGNITO_CLIENT_ID: "1example23456789",
  API_COGNITO_DOMAIN: "https://example.auth.ap-northeast-1.amazoncognito.com",
  API_COGNITO_CLIENT_SECRET_PARAMETER: "/instant-composition/dev/web-client-secret",
  API_WEB_ORIGINS: "https://app.example.com",
  API_WEB_CALLBACK_URL: "https://app.example.com/api/v1/auth/callback",
  API_WEB_SIGN_OUT_URL: "https://app.example.com/",
  API_MODEL_PROVIDER: "openrouter",
  API_MODEL_ID: "anthropic/claude-haiku-4.5",
  API_OPENROUTER_KEY_PARAMETER: "/instant-composition/dev/app/openrouter-api-key",
};

describe("the API's source on Node's type stripping", () => {
  it("loads every module the API reaches, without a warning", () => {
    const probe = [
      `const api = await import(${JSON.stringify(path.join(repoRoot, "apps/api/src/index.ts"))});`,
      "process.stdout.write(typeof api.createApp);",
    ].join("\n");
    const run = spawnSync(
      process.execPath,
      ["--import", "./scripts/ts-hooks.mjs", "--input-type=module", "--eval", probe],
      { cwd: repoRoot, encoding: "utf8" },
    );

    expect(run.stderr).toBe("");
    expect(run.stdout).toBe("function");
    expect(run.status).toBe(0);
  });

  it.each([
    ["with its configuration, exporting the handler", HOSTED, "function", ""],
    [
      "without the user pool, refusing to start",
      { ...HOSTED, API_COGNITO_USER_POOL_ID: "", API_COGNITO_CLIENT_ID: "" },
      "ERR_API_ENV_INVALID API_COGNITO_USER_POOL_ID,API_COGNITO_CLIENT_ID",
      "",
    ],
    [
      "without the model provider, refusing to start",
      { ...HOSTED, API_MODEL_PROVIDER: "" },
      "ERR_API_ENV_INVALID API_MODEL_PROVIDER",
      "",
    ],
  ])("loads the hosted entry %s", (_, env, stdout, stderr) => {
    const probe = [
      "try {",
      `  const entry = await import(${JSON.stringify(path.join(repoRoot, "apps/api/src/lambda.ts"))});`,
      "  process.stdout.write(typeof entry.handler);",
      "} catch (error) {",
      "  process.stdout.write(`${error.code} ${error.names}`);",
      "}",
    ].join("\n");
    const run = spawnSync(
      process.execPath,
      ["--import", "./scripts/ts-hooks.mjs", "--input-type=module", "--eval", probe],
      { cwd: repoRoot, encoding: "utf8", env },
    );

    expect(run.stderr).toBe(stderr);
    expect(run.stdout).toBe(stdout);
    expect(run.status).toBe(0);
  });
});
