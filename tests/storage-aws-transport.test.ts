import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  awsJson,
  invokeStorageBootstrap,
  deployedStorageZip,
  probeStorageThrottle,
  runStorageCdk,
} from "../scripts/lib/storage-aws-transport.mjs";
import { StorageTransitionError } from "../scripts/lib/storage-runtime.mjs";
vi.mock("node:child_process", () => ({ execFileSync: vi.fn(), spawn: vi.fn() }));
afterEach(() => {
  vi.resetAllMocks();
});
describe("storage transition transport", () => {
  it("executes bounded AWS JSON commands with sanitized failures", () => {
    vi.mocked(execFileSync).mockReturnValue('{"Account":"123456789012"}');
    expect(awsJson(["sts", "get-caller-identity"], {})).toEqual({
      Account: "123456789012",
    });
    expect(execFileSync).toHaveBeenCalledWith(
      "aws",
      ["sts", "get-caller-identity", "--region", "ap-northeast-1", "--output", "json"],
      expect.objectContaining({ timeout: 60000, stdio: ["ignore", "pipe", "pipe"] }),
    );
    vi.mocked(execFileSync).mockReturnValue("");
    expect(awsJson([], {})).toBeNull();
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("private provider details");
    });
    expect(() => awsJson([], {})).toThrow(StorageTransitionError);
  });
  it.each([0, 1, "error"])(
    "awaits the actual CDK process outcome %s",
    async (outcome) => {
      const child = new EventEmitter();
      vi.mocked(spawn).mockReturnValue(child as ChildProcess);
      const result = runStorageCdk(["deploy", "app"], "/owned/fixture");
      if (outcome === "error") child.emit("error", new Error("fixture launch failure"));
      else child.emit("exit", outcome);
      if (outcome === 0) await expect(result).resolves.toBeUndefined();
      else await expect(result).rejects.toBeInstanceOf(StorageTransitionError);
    },
  );
  it("distinguishes a synchronous throttle from an admitted invocation or another provider error", async () => {
    vi.mocked(execFileSync).mockReturnValue("{}");
    expect(await probeStorageThrottle("owned-arn", "/fixture")).toBe(false);
    vi.mocked(execFileSync).mockImplementation(() => {
      throw Object.assign(new Error("rejected"), {
        stderr: Buffer.from("TooManyRequestsException"),
      });
    });
    expect(await probeStorageThrottle("owned-arn", "/fixture")).toBe(true);
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("AccessDeniedException");
    });
    expect(await probeStorageThrottle("owned-arn", "/fixture")).toBe(false);
  });
  it("downloads only bounded AWS code bytes without exposing the private URL", async () => {
    const request = vi.fn(() =>
      Promise.resolve(new Response(new Uint8Array([1, 2, 3]))),
    );
    vi.stubGlobal("fetch", request);
    expect(
      await deployedStorageZip({
        Code: {
          Location: "https://owned-bucket.s3.ap-northeast-1.amazonaws.com/private-code",
        },
      }),
    ).toEqual(Buffer.from([1, 2, 3]));
    expect(request).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: "error" }),
    );
    await expect(
      deployedStorageZip({ Code: { Location: "https://untrusted.example/code" } }),
    ).rejects.toBeInstanceOf(StorageTransitionError);
    await expect(deployedStorageZip({})).rejects.toBeInstanceOf(StorageTransitionError);
    request.mockResolvedValue(new Response("", { status: 403 }));
    await expect(
      deployedStorageZip({
        Code: { Location: "https://owned.s3.amazonaws.com/private" },
      }),
    ).rejects.toBeInstanceOf(StorageTransitionError);
    request.mockResolvedValue(
      new Response("", { headers: { "content-length": String(65 * 1024 * 1024) } }),
    );
    await expect(
      deployedStorageZip({
        Code: { Location: "https://owned.s3.amazonaws.com/private" },
      }),
    ).rejects.toBeInstanceOf(StorageTransitionError);
  });
  it.each(["complete", "function-error", "unknown", "malformed"])(
    "keeps bootstrap checkpoints off command arguments and sanitizes %s outcomes",
    async (outcome) => {
      const root = mkdtempSync(path.join(tmpdir(), "storage437-transport-"));
      mkdirSync(path.join(root, "dist"));
      const checkpoint = JSON.stringify({ cursor: "private learner fixture" });
      vi.mocked(spawn).mockImplementation((_command, args) => {
        const child = Object.assign(new EventEmitter(), {
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          kill: vi.fn(),
        });
        const request = String(args.at(args.indexOf("--payload") + 1)).slice(8);
        expect(args).not.toContain(checkpoint);
        expect(JSON.parse(readFileSync(request, "utf8"))).toEqual({
          storageBootstrap: true,
          checkpoint,
        });
        expect(statSync(request).mode & 0o777).toBe(0o600);
        const response = String(args.at(-1));
        writeFileSync(
          response,
          outcome === "malformed" ? "private provider failure" : '{"complete":true}',
        );
        queueMicrotask(() => {
          if (outcome === "unknown")
            child.emit("error", new Error("private provider failure"));
          else {
            child.stdout.write(
              JSON.stringify({
                StatusCode: 200,
                ...(outcome === "function-error" ? { FunctionError: "Unhandled" } : {}),
              }),
            );
            child.emit("exit", 0);
          }
        });
        return child as unknown as ChildProcess;
      });
      try {
        const result = invokeStorageBootstrap("owned-arn", root, checkpoint);
        if (outcome === "complete")
          await expect(result).resolves.toEqual({ complete: true });
        else await expect(result).rejects.toBeInstanceOf(StorageTransitionError);
        expect(existsSync(path.join(root, "dist/storage-bootstrap-request.json"))).toBe(
          false,
        );
        expect(
          existsSync(path.join(root, "dist/storage-bootstrap-response.json")),
        ).toBe(true);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
