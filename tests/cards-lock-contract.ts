import {
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardsError } from "../scripts/cards/errors.mjs";
import { withLock, LOCK_FILE, STALE_LOCK_MS } from "../scripts/cards/store.mjs";

const source = pathToFileURL(path.resolve("scripts/cards/store.mjs")).href;
const children = new Set<ChildProcessWithoutNullStreams>();
function expectBusy(action: () => unknown): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(CardsError);
    expect(error).toMatchObject({ code: "ERR_CARDS_BUSY" });
    return;
  }
  expect.fail("Expected the content lock to refuse acquisition");
}
function aged(file: string): void {
  const old = new Date(Date.now() - STALE_LOCK_MS - 1000);
  utimesSync(file, old, old);
}
function crash(root: string): void {
  execFileSync(process.execPath, [
    "--input-type=module",
    "-e",
    `import { withLock } from ${JSON.stringify(source)}; withLock(${JSON.stringify(root)}, () => {}, () => process.exit(0));`,
  ]);
  aged(path.join(root, LOCK_FILE));
}

export function describeCardsLockContract(makeRoot: () => string): void {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const child of children) if (child.exitCode === null) child.kill();
    children.clear();
  });
  describe("card write lock ownership", () => {
    it("never breaks an old lock whose owner is still alive", () => {
      const root = makeRoot();
      withLock(
        root,
        () => undefined,
        () => {
          const file = path.join(root, LOCK_FILE);
          const original = readFileSync(file, "utf8");
          vi.spyOn(Date, "now").mockReturnValue(
            statSync(file).mtimeMs + STALE_LOCK_MS + 1,
          );
          expectBusy(() =>
            withLock(
              root,
              () => undefined,
              () => undefined,
            ),
          );
          expect(readFileSync(file, "utf8")).toBe(original);
        },
      );
      expect(existsSync(path.join(root, LOCK_FILE))).toBe(false);
    });
    it.each(["in place", "new inode"])(
      "leaves a replacement owner %s intact in finally",
      (mode) => {
        const root = makeRoot();
        const file = path.join(root, LOCK_FILE);
        let replacement = JSON.stringify({
          pid: process.pid,
          host: hostname(),
          token: "replacement",
        });
        withLock(
          root,
          () => undefined,
          () => {
            if (mode === "new inode") {
              replacement = readFileSync(file, "utf8");
              renameSync(file, `${file}.original`);
            }
            writeFileSync(file, replacement);
          },
        );
        expect(readFileSync(file, "utf8")).toBe(replacement);
      },
    );
    it.each(["legacy", "other host", "live reused PID", "invalid"])(
      "fails closed for old %s ownership",
      (kind) => {
        const root = makeRoot();
        const file = path.join(root, LOCK_FILE);
        writeFileSync(
          file,
          kind === "legacy"
            ? "123\n"
            : JSON.stringify({
                pid: process.pid,
                host: kind === "other host" ? `${hostname()}-other` : hostname(),
                token: kind === "invalid" ? "" : "a-former-owner",
              }),
        );
        aged(file);
        const original = readFileSync(file, "utf8");
        expectBusy(() =>
          withLock(
            root,
            () => undefined,
            () => undefined,
          ),
        );
        expect(readFileSync(file, "utf8")).toBe(original);
      },
    );
    it("does not reclaim an owner replaced in place during the liveness check", () => {
      const root = makeRoot();
      const file = path.join(root, LOCK_FILE);
      writeFileSync(
        file,
        JSON.stringify({ pid: process.pid, host: hostname(), token: "observed" }),
      );
      aged(file);
      const replacement = JSON.stringify({
        pid: process.pid,
        host: hostname(),
        token: "replacement",
      });
      vi.spyOn(process, "kill").mockImplementation(() => {
        writeFileSync(file, replacement);
        throw Object.assign(new Error("gone"), { code: "ESRCH" });
      });
      expectBusy(() =>
        withLock(
          root,
          () => undefined,
          () => undefined,
        ),
      );
      expect(readFileSync(file, "utf8")).toBe(replacement);
    });
    it("retains ownership when process liveness cannot be checked", () => {
      const root = makeRoot();
      const file = path.join(root, LOCK_FILE);
      writeFileSync(
        file,
        JSON.stringify({ pid: process.pid, host: hostname(), token: "held" }),
      );
      aged(file);
      vi.spyOn(process, "kill").mockImplementation(() => {
        throw Object.assign(new Error("permission denied"), { code: "EPERM" });
      });
      expectBusy(() =>
        withLock(
          root,
          () => undefined,
          () => undefined,
        ),
      );
      expect(existsSync(file)).toBe(true);
    });
    it("leaves an interrupted acquisition guard untouched and fails fast", () => {
      const root = makeRoot();
      const file = path.join(root, `${LOCK_FILE}.claim`);
      writeFileSync(file, "partial metadata");
      aged(file);
      expectBusy(() =>
        withLock(
          root,
          () => undefined,
          () => undefined,
        ),
      );
      expect(readFileSync(file, "utf8")).toBe("partial metadata");
      expect(existsSync(path.join(root, LOCK_FILE))).toBe(false);
    });
    it("does not follow or remove an unknown lock symlink", () => {
      const root = makeRoot();
      const target = path.join(root, "target");
      writeFileSync(target, "unknown");
      symlinkSync(target, path.join(root, LOCK_FILE));
      expectBusy(() =>
        withLock(
          root,
          () => undefined,
          () => undefined,
        ),
      );
      expect(readFileSync(target, "utf8")).toBe("unknown");
    });
    it("refuses a FIFO lock without blocking or removing it", () => {
      const root = makeRoot();
      const file = path.join(root, LOCK_FILE);
      execFileSync("mkfifo", [file]);
      const errors = pathToFileURL(path.resolve("scripts/cards/errors.mjs")).href;
      const code = `import { withLock } from ${JSON.stringify(source)};
        import { CardsError } from ${JSON.stringify(errors)};
        try { withLock(${JSON.stringify(root)}, () => {}, () => {}); process.exit(1); }
        catch (error) { if (!(error instanceof CardsError) || error.code !== "ERR_CARDS_BUSY") throw error; process.stdout.write(error.code); }`;
      expect(
        execFileSync(process.execPath, ["--input-type=module", "-e", code], {
          timeout: 2000,
          encoding: "utf8",
        }),
      ).toBe("ERR_CARDS_BUSY");
      expect(statSync(file).isFIFO()).toBe(true);
      expect(existsSync(`${file}.claim`)).toBe(false);
    });
    it("recovers a confirmed dead child's old lock and releases its own", () => {
      const root = makeRoot();
      crash(root);
      const warnings: string[] = [];
      expect(
        withLock(
          root,
          (text) => warnings.push(text),
          () => "written",
        ),
      ).toBe("written");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^Breaking a stale lock:/u);
      expect(existsSync(path.join(root, LOCK_FILE))).toBe(false);
    });
    it("allows only one contender into a write while recovering a dead owner", async () => {
      const root = makeRoot();
      crash(root);
      const release = path.join(root, "release");
      const trace = path.join(root, "trace");
      let entered: () => void = () => undefined;
      let refused: () => void = () => undefined;
      const hasEntered = new Promise<void>((done) => {
        entered = done;
      });
      const hasRefused = new Promise<void>((done) => {
        refused = done;
      });
      function launch() {
        const code = `import { withLock } from ${JSON.stringify(source)};
          import { appendFileSync, existsSync } from "node:fs";
          process.stdout.write("ready\\n");
          process.stdin.once("data", () => {
            try { withLock(${JSON.stringify(root)}, () => {}, () => {
              appendFileSync(${JSON.stringify(trace)}, "enter\\n");
              process.stdout.write("entered\\n");
              while (!existsSync(${JSON.stringify(release)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
              appendFileSync(${JSON.stringify(trace)}, "exit\\n");
            }); } catch (error) { if (error.code !== "ERR_CARDS_BUSY") throw error; process.stdout.write("busy\\n"); }
          });`;
        const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
          stdio: "pipe",
        });
        children.add(child);
        let ready: () => void = () => undefined;
        const started = new Promise<void>((done) => {
          ready = done;
        });
        let output = "";
        let errors = "";
        child.stdout.on("data", (data: Buffer) => {
          output += data.toString();
          if (output.includes("ready\n")) ready();
          if (output.includes("entered\n")) entered();
          if (output.includes("busy\n")) refused();
        });
        child.stderr.on("data", (data: Buffer) => {
          errors += data.toString();
        });
        const exited = new Promise<void>((resolve, reject) => {
          child.once("error", reject);
          child.once("exit", (status) =>
            status === 0 ? resolve() : reject(new Error(errors)),
          );
        });
        void exited.catch(() => undefined);
        return { child, started, exited };
      }
      const contenders = [launch(), launch()];
      try {
        await Promise.all(contenders.map((item) => item.started));
        for (const { child } of contenders) child.stdin.end("go\n");
        await Promise.all([hasEntered, hasRefused]);
        expect(readFileSync(trace, "utf8")).toBe("enter\n");
        writeFileSync(release, "go");
        await Promise.all(contenders.map((item) => item.exited));
        expect(readFileSync(trace, "utf8")).toBe("enter\nexit\n");
        expect(existsSync(path.join(root, LOCK_FILE))).toBe(false);
      } finally {
        writeFileSync(release, "go");
        for (const { child } of contenders) if (child.exitCode === null) child.kill();
      }
    }, 10_000);
  });
}
