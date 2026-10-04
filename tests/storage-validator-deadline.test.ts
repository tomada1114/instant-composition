import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { createStorageValidator } from "../scripts/lib/storage-validator.mjs";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:timers", () => ({
  setTimeout: (callback: () => void, ms: number) => globalThis.setTimeout(callback, ms),
  clearTimeout: (timer: ReturnType<typeof setTimeout>) =>
    globalThis.clearTimeout(timer),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("refuses an expired validator before starting its decoder", () => {
  expect(() => createStorageValidator(undefined, Date.now() - 1)).toThrow(
    "ERR_STORAGE_VALIDATOR_REFUSED",
  );
  expect(spawn).not.toHaveBeenCalled();
});

it("kills an unresponsive decoder and waits for closure before rejecting its request", async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
  const validator = createStorageValidator(undefined, Date.now() + 1000);
  const request = validator.request([{ private: "fixture" }]);
  const settled = vi.fn();
  const outcome = request.then(settled, settled);
  await vi.advanceTimersByTimeAsync(1000);
  expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  expect(settled).not.toHaveBeenCalled();
  const closed = validator.close();
  child.emit("close", null, "SIGKILL");
  await outcome;
  await closed;
  await expect(request).rejects.toThrow("ERR_STORAGE_VALIDATOR_REFUSED");
});

it("retains a deadline while waiting for a decoder to exit after a successful response", async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
  const validator = createStorageValidator(undefined, Date.now() + 1000);
  const request = validator.request([]);
  child.stdout.emit("data", '{"ok":true,"rows":[]}\n');
  await expect(request).resolves.toMatchObject({ ok: true });
  const closed = validator.close();
  const settled = vi.fn();
  void closed.then(settled);
  await vi.advanceTimersByTimeAsync(1000);
  expect(child.kill).toHaveBeenCalledOnce();
  expect(settled).not.toHaveBeenCalled();
  child.emit("close", null, "SIGKILL");
  await closed;
});
