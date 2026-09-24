import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/** Where `pnpm api` listens unless `API_PORT` says otherwise (`apps/api/src/env.ts`). */
const DEFAULT_API_PORT = "8787";

/**
 * The static SPA (ADR-0008): `vite build` writes it to `dist/`, and the dev
 * server proxies `/api` to the local API so the client calls its own origin,
 * as it will behind CloudFront.
 *
 * @remarks
 * `envDir: false` loads no `.env` file: nothing here is configured through
 * one, and AGENTS.md keeps tools off `.env*` altogether. `loadEnv` with
 * `false` reads the shell's `API_*` variables alone.
 */
export default defineConfig(({ mode }) => {
  const apiPort = loadEnv(mode, false, "API_")["API_PORT"] ?? DEFAULT_API_PORT;
  const proxy = { "/api": `http://127.0.0.1:${apiPort}` };
  return {
    envDir: false,
    plugins: [react(), tailwindcss()],
    server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy },
    preview: { host: "127.0.0.1", port: 4173, strictPort: true, proxy },
    build: { outDir: "dist", emptyOutDir: true },
  };
});
