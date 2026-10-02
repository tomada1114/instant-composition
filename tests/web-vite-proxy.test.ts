import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";
import { createViteServer } from "vitest/node";

const webRoot = fileURLToPath(new URL("../apps/web/", import.meta.url));

/** The `/api` proxy target apps/web/vite.config.ts resolves under the current environment. */
async function apiProxyTarget(): Promise<unknown> {
  const server = await createViteServer({
    root: webRoot,
    configFile: `${webRoot}vite.config.ts`,
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  try {
    return server.config.server.proxy?.["/api"];
  } finally {
    await server.close();
  }
}

describe("apps/web's /api proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["unset", undefined],
    ["blank", ""],
    ["whitespace", "  "],
  ])("targets the API's default port when API_PORT is %s", async (_, value) => {
    vi.stubEnv("API_PORT", value);
    await expect(apiProxyTarget()).resolves.toBe("http://127.0.0.1:8787");
  });

  it("targets the port API_PORT names", async () => {
    vi.stubEnv("API_PORT", "8799");
    await expect(apiProxyTarget()).resolves.toBe("http://127.0.0.1:8799");
  });
});
