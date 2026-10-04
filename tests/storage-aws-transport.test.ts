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
import process from "node:process";
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
vi.mock("node:timers", () => ({
  setTimeout: (callback: () => void, ms: number) => globalThis.setTimeout(callback, ms),
  clearTimeout: (timer: ReturnType<typeof setTimeout>) =>
    globalThis.clearTimeout(timer),
}));
afterEach(() => {
  vi.resetAllMocks();
});
describe("storage transition transport", () => {
  it("refuses expired commands before a subprocess or download starts", async () => {
    const deadline = Date.now() - 1;
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    expect(() => awsJson(["sts", "get-caller-identity"], {}, deadline)).toThrow(
      StorageTransitionError,
    );
    expect(() => runStorageCdk(["deploy", "app"], "/fixture", deadline)).toThrow(
      StorageTransitionError,
    );
    expect(() => probeStorageThrottle("arn", "/fixture", deadline)).toThrow(
      StorageTransitionError,
    );
    await expect(deployedStorageZip({}, deadline)).rejects.toThrow(
      StorageTransitionError,
    );
    await expect(
      invokeStorageBootstrap("arn", "/fixture", null, deadline),
    ).rejects.toThrow(StorageTransitionError);
    expect(execFileSync).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
  it("limits synchronous AWS calls to the remaining time and kills the process on timeout", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000000);
    vi.mocked(execFileSync).mockReturnValue("{}");
    awsJson(["lambda", "get-function"], {}, 1000123);
    expect(execFileSync).toHaveBeenCalledWith(
      "aws",
      expect.any(Array),
      expect.objectContaining({ timeout: 123, killSignal: "SIGKILL" }),
    );
  });
  it("kills the entire CDK group at the deadline and waits for process closure before cleanup can start", async () => {
    vi.useFakeTimers();
    try {
      const child = Object.assign(new EventEmitter(), { pid: 4242, kill: vi.fn() });
      const kill = vi.spyOn(process, "kill").mockReturnValue(true);
      vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
      const result = runStorageCdk(["deploy", "app"], "/fixture", Date.now() + 1000);
      const settled = vi.fn();
      const outcome = result.then(settled, settled);
      await vi.advanceTimersByTimeAsync(1000);
      expect(kill).toHaveBeenCalledExactlyOnceWith(-4242, "SIGKILL");
      expect(settled).not.toHaveBeenCalled();
      child.emit("close", null, "SIGKILL");
      await outcome;
      await expect(result).rejects.toMatchObject({ part: "transition work deadline" });
      expect(spawn).toHaveBeenCalledWith(
        "pnpm",
        ["cdk", "deploy", "app"],
        expect.objectContaining({ detached: true }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it("reports only a known AWS operation and error code, retaining no provider response", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw Object.assign(new Error("private details"), {
        stderr: Buffer.from("AccessDeniedException signed-private-url"),
      });
    });
    let failure: unknown;
    try {
      awsJson(["lambda", "get-function", "--function-name", "private-resource"], {});
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(StorageTransitionError);
    expect(failure).toHaveProperty(
      "part",
      "AWS lambda get-function AccessDeniedException",
    );
    expect(JSON.stringify(failure)).not.toContain("signed-private-url");
    expect(JSON.stringify(failure)).not.toContain("private-resource");
  });
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
      else child.emit("close", outcome);
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
            child.emit("close", 0);
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

const signedCode = {
  Code: { Location: "https://owned.s3.amazonaws.com/code?token=private-signed-token" },
};
function transportError(code: string, nested = true): TypeError {
  return Object.assign(
    new TypeError("private-signed-token provider body"),
    nested ? { cause: { code } } : { code },
  );
}
function brokenBody(error: unknown): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.error(error);
      },
    }),
  );
}
describe("bounded deployed ZIP download failures", () => {
  it("sanitizes a native malformed URL before any fetch", async () => {
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    const error = await deployedStorageZip({
      Code: { Location: "private-signed-token" },
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(StorageTransitionError);
    expect(error).toMatchObject({ part: "AWS code location TypeError" });
    expect(JSON.stringify(error)).not.toContain("private-signed-token");
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    ["fetch", new TypeError("private-signed-token"), "AWS code fetch TypeError"],
    [
      "body",
      new DOMException("private-signed-token", "AbortError"),
      "AWS code body AbortError",
    ],
    [
      "body",
      Object.assign(new Error("private-signed-token"), {
        name: "private-signed-token",
      }),
      "AWS code body unknown",
    ],
  ] as const)(
    "sanitizes %s native rejection without a blind retry",
    async (stage, failure, part) => {
      const request = vi.fn<typeof fetch>();
      if (stage === "fetch") request.mockRejectedValue(failure);
      else request.mockResolvedValue(brokenBody(failure));
      vi.stubGlobal("fetch", request);
      const error = await deployedStorageZip(signedCode).catch(
        (value: unknown) => value,
      );
      expect(error).toBeInstanceOf(StorageTransitionError);
      expect(error).toMatchObject({ part });
      expect(JSON.stringify(error)).not.toContain("private-signed-token");
      expect(error).not.toHaveProperty("cause");
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"])(
    "retries positive transient %s once with the same URL and shared signal",
    async (code) => {
      vi.useFakeTimers();
      try {
        const request = vi
          .fn<typeof fetch>()
          .mockRejectedValueOnce(transportError(code))
          .mockResolvedValueOnce(new Response(new Uint8Array([7, 8])));
        vi.stubGlobal("fetch", request);
        const result = deployedStorageZip(signedCode, Date.now() + 1000).catch(
          (error: unknown) => error,
        );
        await vi.advanceTimersByTimeAsync(99);
        expect(request).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(await result).toEqual(Buffer.from([7, 8]));
        expect(request).toHaveBeenCalledTimes(2);
        expect(request.mock.calls[1]?.[0]).toBe(request.mock.calls[0]?.[0]);
        expect(request.mock.calls[1]?.[1]?.signal).toBe(
          request.mock.calls[0]?.[1]?.signal,
        );
        expect(request.mock.calls[1]?.[1]?.redirect).toBe("error");
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("discards a transient partial body and returns only the second response", async () => {
    vi.useFakeTimers();
    try {
      const first = new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([99]));
            controller.error(transportError("ECONNRESET", false));
          },
        }),
      );
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(new Response(new Uint8Array([1, 2])));
      vi.stubGlobal("fetch", request);
      const result = deployedStorageZip(signedCode).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(100);
      expect(await result).toEqual(Buffer.from([1, 2]));
      expect(request).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("stops persistent transient failures after two attempts", async () => {
    vi.useFakeTimers();
    try {
      const request = vi
        .fn<typeof fetch>()
        .mockRejectedValue(transportError("EAI_AGAIN"));
      vi.stubGlobal("fetch", request);
      const result = deployedStorageZip(signedCode).catch((value: unknown) => value);
      await vi.advanceTimersByTimeAsync(100);
      expect(await result).toMatchObject({ part: "AWS code fetch TypeError" });
      expect(request).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([1000, 30000])(
    "expires at the original %ims total window despite a delayed first failure and hanging retry body",
    async (window) => {
      vi.useFakeTimers();
      try {
        const request = vi
          .fn<typeof fetch>()
          .mockImplementationOnce(
            () =>
              new Promise((_resolve, reject) => {
                setTimeout(() => reject(transportError("ETIMEDOUT")), 400);
              }),
          )
          .mockResolvedValueOnce(new Response(new ReadableStream()));
        vi.stubGlobal("fetch", request);
        const result = deployedStorageZip(
          signedCode,
          Date.now() + window + (window === 30000 ? 10000 : 0),
        ).catch((value: unknown) => value);
        await vi.advanceTimersByTimeAsync(500);
        expect(request).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(window - 500);
        expect(await result).toMatchObject({ part: "AWS code download TimeoutError" });
        expect(request.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("does not retry a transient failure without room for the backoff", async () => {
    vi.useFakeTimers();
    try {
      const request = vi
        .fn<typeof fetch>()
        .mockRejectedValue(transportError("ECONNRESET"));
      vi.stubGlobal("fetch", request);
      await expect(
        deployedStorageZip(signedCode, Date.now() + 100),
      ).rejects.toMatchObject({ part: "AWS code fetch TypeError" });
      expect(request).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    "CERT_HAS_EXPIRED",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "ECONNREFUSED",
    "unknown",
  ])("does not retry non-allowlisted transport code %s", async (code) => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(transportError(code));
    vi.stubGlobal("fetch", request);
    await expect(deployedStorageZip(signedCode)).rejects.toMatchObject({
      part: "AWS code fetch TypeError",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    [
      "HTTP refusal",
      new Response("private-signed-token", { status: 503 }),
      "AWS code download",
    ],
    [
      "declared oversize",
      new Response("", { headers: { "content-length": String(65 * 1024 * 1024) } }),
      "AWS code download",
    ],
  ] as const)("keeps %s permanent without retry", async (_, response, part) => {
    vi.useFakeTimers();
    try {
      const request = vi.fn<typeof fetch>().mockResolvedValue(response);
      vi.stubGlobal("fetch", request);
      await expect(deployedStorageZip(signedCode)).rejects.toMatchObject({ part });
      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("deployed ZIP total expiry", () => {
  it("never retries an expired first fetch, aborts it, and cleans the deadline timer", async () => {
    vi.useFakeTimers();
    try {
      const request = vi
        .fn<typeof fetch>()
        .mockImplementation(() => new Promise(() => undefined));
      vi.stubGlobal("fetch", request);
      const result = deployedStorageZip(signedCode, Date.now() + 1000).catch(
        (value: unknown) => value,
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(await result).toMatchObject({ part: "AWS code download TimeoutError" });
      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      expect(request.mock.calls[0]?.[1]?.signal?.reason).toMatchObject({
        part: "AWS code download TimeoutError",
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
