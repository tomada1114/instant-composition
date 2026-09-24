import consoleModule from "node:console";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { readApiEnv } from "@instant-composition/api";

import {
  assertInstalled,
  DEFAULT_CATALOG,
  DevError,
  ensureCatalog,
  stackProcesses,
  superviseStack,
} from "../scripts/dev.mjs";

// `pnpm dev` runs the API and the web client's dev server side by side. What
// it runs has to stay what `pnpm api` and `pnpm web` run, so a change to either
// is not quietly missing from the one-command stack; and the supervisor has to
// take the stack down whole, whichever way it ends. Its children here are
// throwaway Node processes, never the servers themselves.

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const workspaces: string[] = [];

function makeRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dev-test-"));
  workspaces.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** One package script out of a manifest. */
function script(manifestPath: string, name: string): string {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    scripts: Record<string, string>;
  };
  const body = manifest.scripts[name];
  if (body === undefined) throw new Error(`${manifestPath} has no "${name}" script.`);
  return body;
}

/** A process of the stack that runs `code` on Node. */
function nodeProcess(name: string, code: string) {
  return { name, entry: process.execPath, args: ["-e", code], cwd: repoRoot };
}

const FOREVER = "setInterval(() => {}, 1000);";

describe("the processes pnpm dev runs", () => {
  const [api, web] = stackProcesses();

  it("runs the API exactly as `pnpm api` does", () => {
    expect(api?.name).toBe("api");
    expect(api?.cwd).toBe(repoRoot);
    expect(["node", ...(api?.args ?? [])].join(" ")).toBe(
      script(path.join(repoRoot, "package.json"), "api"),
    );
  });

  it("runs the web client's own Vite, from its own directory, as `pnpm web` does", () => {
    const webRoot = path.join(repoRoot, "apps", "web");
    expect(script(path.join(webRoot, "package.json"), "dev")).toBe("vite");
    expect(web?.cwd).toBe(webRoot);
    expect(web?.entry).toBe(
      path.join(webRoot, "node_modules", "vite", "bin", "vite.js"),
    );
    expect(web?.args).toStrictEqual([web?.entry]);
  });

  it("finds every entry installed in this checkout", () => {
    expect(() => {
      assertInstalled(stackProcesses());
    }).not.toThrow();
  });

  it("names each missing entry and what to run", () => {
    const root = makeRoot();
    try {
      assertInstalled(stackProcesses(root));
      expect.unreachable("assertInstalled accepted a root with nothing installed");
    } catch (error) {
      expect(error).toBeInstanceOf(DevError);
      const devError = error as DevError;
      expect(devError.code).toBe("ERR_DEV_NOT_INSTALLED");
      expect(devError.actual).toContain("api (");
      expect(devError.actual).toContain("web (");
      expect(devError.report()).toMatch(
        /^ERR_DEV_NOT_INSTALLED: .*\nExpected: .*\nActual: .*\nNext: run `pnpm install`/u,
      );
    }
  });
});

describe("the catalog snapshot pnpm dev starts the API with", () => {
  it("is the one the API reads by default", () => {
    expect(readApiEnv({}).catalogPath).toBe(DEFAULT_CATALOG);
  });

  it("leaves a snapshot API_CATALOG_PATH names to its caller", () => {
    const build = vi.fn(() => ({ status: 0, stderr: "" }));

    expect(
      ensureCatalog(
        { API_CATALOG_PATH: "elsewhere.json" },
        { root: makeRoot(), build },
      ),
    ).toBe("configured");
    expect(build).not.toHaveBeenCalled();
  });

  it("uses the default snapshot as it is when it is on disk", () => {
    const root = makeRoot();
    mkdirSync(path.join(root, path.dirname(DEFAULT_CATALOG)), { recursive: true });
    writeFileSync(path.join(root, DEFAULT_CATALOG), "{}");
    const build = vi.fn(() => ({ status: 0, stderr: "" }));

    expect(ensureCatalog({ API_CATALOG_PATH: " " }, { root, build })).toBe("present");
    expect(build).not.toHaveBeenCalled();
  });

  it("builds the default snapshot when it is missing", () => {
    const build = vi.fn(() => ({ status: 0, stderr: "" }));

    expect(ensureCatalog({}, { root: makeRoot(), build })).toBe("built");
    expect(build).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "with the build's own report",
      "ERR_CATALOG_CONTENT: bad card\n",
      "ERR_CATALOG_CONTENT: bad card",
    ],
    ["without one", "", "it failed without a report."],
  ])("refuses to start when the build fails, %s", (_label, stderr, actual) => {
    const build = () => ({ status: 1, stderr });
    try {
      ensureCatalog({}, { root: makeRoot(), build });
      expect.unreachable("ensureCatalog accepted a failed build");
    } catch (error) {
      expect(error).toBeInstanceOf(DevError);
      expect((error as DevError).code).toBe("ERR_DEV_CATALOG");
      expect((error as DevError).actual).toBe(actual);
    }
  });

  it("builds from this checkout's content with the real command when none is given", () => {
    // A root holding no content: the real build runs and fails, which is what
    // proves it was the one invoked, without writing into this checkout.
    const root = makeRoot();
    mkdirSync(path.join(root, "scripts", "catalog"), { recursive: true });
    writeFileSync(
      path.join(root, "scripts", "catalog", "build.mjs"),
      'process.stderr.write("stand-in build ran"); process.exitCode = 3;',
    );

    expect(() => ensureCatalog({}, { root })).toThrow(DevError);
    try {
      ensureCatalog({}, { root });
    } catch (error) {
      expect((error as DevError).actual).toBe("stand-in build ran");
    }
  });
});

describe("the supervisor pnpm dev runs the stack under", () => {
  it("stops every process on Ctrl-C and exits cleanly", async () => {
    const signals = new EventEmitter();
    const run = superviseStack(
      [nodeProcess("api", FOREVER), nodeProcess("web", FOREVER)],
      { signals },
    );
    await vi.waitFor(() => {
      expect(signals.listenerCount("SIGINT")).toBe(1);
    });
    signals.emit("SIGINT");

    await expect(run).resolves.toBe(0);
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });

  it("takes the rest down and fails when one process exits on its own", async () => {
    const errorSpy = vi
      .spyOn(consoleModule, "error")
      .mockImplementation(() => undefined);

    const code = await superviseStack(
      [nodeProcess("api", "process.exitCode = 3;"), nodeProcess("web", FOREVER)],
      { signals: new EventEmitter() },
    );

    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(
        /^ERR_DEV_EXITED: the api process stopped on its own\.\n.*\nActual: api exited with 3\./u,
      ),
    );
  });

  it("treats a process ended by an interrupt as a stop, not a failure", async () => {
    const errorSpy = vi
      .spyOn(consoleModule, "error")
      .mockImplementation(() => undefined);

    const code = await superviseStack(
      [
        nodeProcess("api", 'process.kill(process.pid, "SIGINT");' + FOREVER),
        nodeProcess("web", FOREVER),
      ],
      { signals: new EventEmitter() },
    );

    expect(code).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("kills a process that ignores the stop request once the grace period ends", async () => {
    const signals = new EventEmitter();
    const stubborn = nodeProcess(
      "web",
      'process.on("SIGTERM", () => {}); process.stdout.write(""); ' + FOREVER,
    );
    const run = superviseStack([stubborn], { signals, graceMs: 200 });
    // Give the child time to install its handler before it is asked to stop.
    await new Promise((resolve) => setTimeout(resolve, 500));
    signals.emit("SIGTERM");

    await expect(run).resolves.toBe(0);
  });

  it("reports a process that could not be started at all", async () => {
    const errorSpy = vi
      .spyOn(consoleModule, "error")
      .mockImplementation(() => undefined);

    const code = await superviseStack([nodeProcess("api", FOREVER)], {
      signals: new EventEmitter(),
      execPath: path.join(makeRoot(), "no-such-node"),
    });

    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("api could not run ("),
    );
  });
});
