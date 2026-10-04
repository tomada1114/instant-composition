import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { afterEach, describe, expect, it } from "vitest";

import { repoRoot } from "../scripts/lib/node-tools.mjs";

const script = path.join(
  repoRoot,
  ".agents/skills/cloud-shipping-one-issue/scripts/install.sh",
);
const workspaces: string[] = [];

function runInstall(
  packageManager: string,
  exitCode = 0,
  failureStage: "install" | "hooks" | "verification" = "install",
) {
  const workspace = mkdtempSync(path.join(tmpdir(), "cloud-install-test-"));
  workspaces.push(workspace);
  const bin = path.join(workspace, "bin");
  mkdirSync(bin);
  writeFileSync(
    path.join(workspace, "package.json"),
    JSON.stringify({ packageManager }),
  );
  const corepack = path.join(bin, "corepack");
  writeFileSync(
    corepack,
    [
      "#!/bin/sh",
      'printf "%s\\n" "CI=${CI-unset}" "$COREPACK_HOME" "$PNPM_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME" "$@"',
      `if [ "$2" = "${failureStage === "hooks" ? "run" : "install"}" ]; then exit ${String(failureStage === "verification" ? 0 : exitCode)}; fi`,
      "",
    ].join("\n"),
  );
  chmodSync(corepack, 0o755);
  mkdirSync(path.join(workspace, "scripts"));
  writeFileSync(
    path.join(workspace, "scripts", "verify-hooks.mjs"),
    `console.log('verified:CI=' + (process.env.CI ?? 'unset')); process.exit(${String(failureStage === "verification" ? exitCode : 0)});\n`,
  );
  return spawnSync("bash", [script], {
    cwd: workspace,
    env: {
      ...process.env,
      CI: "true",
      PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
      COREPACK_HOME: "/unavailable/cache",
      PNPM_HOME: "/unavailable/pnpm",
      XDG_DATA_HOME: "/unavailable/data",
      XDG_CACHE_HOME: "/unavailable/cache",
      XDG_STATE_HOME: "/unavailable/state",
    },
    encoding: "utf8",
    timeout: 10_000,
  });
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("Cloud dependency installation", () => {
  it.each(["pnpm@11.18.0", "pnpm@11.18.1"])(
    "uses the checkout's %s pin and writable caches with lifecycle scripts enabled",
    (packageManager) => {
      const result = runInstall(packageManager);
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split("\n")).toEqual([
        "CI=unset",
        "/tmp/instant-composition-corepack",
        "/tmp/instant-composition-pnpm",
        "/tmp/instant-composition-xdg/data",
        "/tmp/instant-composition-xdg/cache",
        "/tmp/instant-composition-xdg/state",
        packageManager,
        "install",
        "--frozen-lockfile",
        "CI=unset",
        "/tmp/instant-composition-corepack",
        "/tmp/instant-composition-pnpm",
        "/tmp/instant-composition-xdg/data",
        "/tmp/instant-composition-xdg/cache",
        "/tmp/instant-composition-xdg/state",
        packageManager,
        "run",
        "hooks:install",
        "verified:CI=unset",
      ]);
      expect(result.stderr).toBe("");
    },
  );

  it("propagates an installation failure instead of reporting setup success", () => {
    const result = runInstall("pnpm@11.18.0", 23);
    expect(result.status).toBe(23);
    expect(result.stdout).not.toContain("hooks:install");
    expect(result.stdout).not.toContain("verified:");
  });

  it("stops setup when hook installation fails", () => {
    const result = runInstall("pnpm@11.18.0", 24, "hooks");
    expect(result.status).toBe(24);
    expect(result.stdout).not.toContain("verified:");
  });

  it("does not report success when installed hooks fail verification", () => {
    const result = runInstall("pnpm@11.18.0", 25, "verification");
    expect(result.status).toBe(25);
    expect(result.stdout).toContain("verified:CI=unset");
  });
});
