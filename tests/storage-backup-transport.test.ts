import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { backupOptions, backupPort } from "../scripts/lib/storage-backup.mjs";
import { createStorageValidator } from "../scripts/lib/storage-validator.mjs";
vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("../scripts/lib/storage-validator.mjs", () => ({
  createStorageValidator: vi.fn(() => ({
    request: () => Promise.resolve({ rows: [] }),
    close: () => Promise.resolve(),
  })),
}));
describe("private backup transport", () => {
  it("captures tool output and sends raw cursor keys only over private stdin", async () => {
    vi.mocked(execFileSync).mockReturnValue('{"Items":[]}');
    const p = backupPort(
      backupOptions([
        "create",
        "--table",
        "instant-composition-dev-fixture",
        "--profile",
        "dev",
      ]),
    );
    expect(
      await p.call("scan", {
        ExclusiveStartKey: { PK: { S: "LEARNER_TEXT_SENTINEL" } },
      }),
    ).toStrictEqual({ Items: [] });
    const call = vi.mocked(execFileSync).mock.calls.at(-1);
    expect(call?.[1]).not.toContain("LEARNER_TEXT_SENTINEL");
    expect(call?.[2]).toMatchObject({
      input: '{"ExclusiveStartKey":{"PK":{"S":"LEARNER_TEXT_SENTINEL"}}}',
      stdio: ["pipe", "pipe", "pipe"],
      env: { AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true" },
    });
    expect(await p.validate([])).toStrictEqual({ rows: [] });
    expect(vi.mocked(createStorageValidator)).toHaveBeenCalledWith(
      "dev",
      expect.any(Number),
    );
    await p.close();
  });
  it("uses dummy credentials for explicit loopback endpoints", async () => {
    vi.mocked(execFileSync).mockReturnValue("{}");
    const p = backupPort(
      backupOptions([
        "create",
        "--table",
        "local-fixture",
        "--endpoint",
        "http://127.0.0.1:8000",
      ]),
    );
    await p.call("scan", {});
    expect(vi.mocked(execFileSync).mock.calls.at(-1)?.[2]).toMatchObject({
      env: {
        AWS_ACCESS_KEY_ID: "local",
        AWS_SECRET_ACCESS_KEY: "local",
        AWS_SESSION_TOKEN: "",
      },
    });
    await p.close();
  });
  it.each(["tool", "json"])(
    "redacts %s failure including captured stdout and stderr",
    async (kind) => {
      vi.mocked(execFileSync).mockImplementation(() => {
        if (kind === "json") return "LEARNER_TEXT_SENTINEL CREDENTIAL_SENTINEL";
        throw Object.assign(new Error("LEARNER_TEXT_SENTINEL CREDENTIAL_SENTINEL"), {
          stdout: "LEARNER_TEXT_SENTINEL",
          stderr: "CREDENTIAL_SENTINEL",
        });
      });
      const p = backupPort(
        backupOptions([
          "create",
          "--table",
          "instant-composition-dev-fixture",
          "--profile",
          "dev",
        ]),
      );
      expect(() => p.call("scan", {})).toThrow(
        expect.objectContaining({ code: "ERR_STORAGE_BACKUP_FAILED" }),
      );
      await p.close();
    },
  );
});
