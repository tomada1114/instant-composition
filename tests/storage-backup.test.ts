import { describe, expect, it } from "vitest";
import {
  backupOptions,
  isRestoreTable,
  runBackup,
  StorageBackupError,
  type BackupPort,
} from "../scripts/lib/storage-backup.mjs";

const table = "instant-composition-dev-fixture";
const arn = `arn:aws:dynamodb:ap-northeast-1:123456789012:table/${table}/backup/0123456789-abcd`;
const restored = `${table}-restore-20261102T120000000Z`;
const options = (command: string, extra: string[] = []) =>
  backupOptions([command, "--table", table, "--profile", "dev", ...extra]);
function port(call: BackupPort["call"]): BackupPort & { closed: boolean } {
  return {
    call,
    validate: (rows) => Promise.resolve({ rows }),
    wait: () => Promise.resolve(),
    now: () => new Date("2026-11-02T12:00:00.000Z"),
    closed: false,
    close() {
      this.closed = true;
      return Promise.resolve();
    },
  };
}
const available = {
  BackupDescription: {
    BackupDetails: {
      BackupStatus: "AVAILABLE",
      BackupCreationDateTime: "2026-11-02T12:00:00.000Z",
    },
    SourceTableDetails: { TableName: table },
  },
};
describe("storage backup operator", () => {
  it.each(
    [
      [],
      ["delete"],
      ["create", "--table", "instant-composition-prod-data", "--profile", "dev"],
      ["create", "--table", table],
      ["create", "--table", table, "--endpoint", "http://evil.example:8000"],
      ["create", "--table", table, "--endpoint", "http://127.0.0.1:65536"],
      ["create", "--table", table, "--profile", "dev", "--table", table],
      ["create", "--table", table, "--profile", "dev", "--unknown", "value"],
      ["restore", "--table", table, "--profile", "dev", "--backup", "arn:other"],
      ["verify", "--table", table, "--profile", "dev", "--restored", table],
      [
        "verify",
        "--table",
        table,
        "--profile",
        "dev",
        "--restored",
        `${table}-restore-20260230T120000000Z`,
      ],
    ].map((args) => ({ args })),
  )("rejects unsafe arguments before access %j", ({ args }) => {
    expect(() => backupOptions(args)).toThrow(StorageBackupError);
  });
  it("accepts explicit dev commands and loopback local verification", () => {
    expect(options("create")).toMatchObject({ command: "create", table });
    expect(options("restore", ["--backup", arn])).toMatchObject({ backup: arn });
    expect(
      backupOptions([
        "verify",
        "--table",
        table,
        "--endpoint",
        "http://localhost:8000",
        "--restored",
        restored,
      ]),
    ).toMatchObject({ restored });
    expect(isRestoreTable(table, `${table}-restore-garbage`)).toBe(false);
    expect(isRestoreTable(table, restored)).toBe(true);
  });
  it("waits for an available backup and returns only ARN and creation time", async () => {
    const operations: string[] = [];
    const p = port((operation) => {
      operations.push(operation);
      if (operation === "create-backup")
        return Promise.resolve({
          BackupDetails: { BackupArn: arn, learnerText: "PRIVATE" },
        });
      return Promise.resolve(
        operations.length === 2
          ? { BackupDescription: { BackupDetails: { BackupStatus: "CREATING" } } }
          : available,
      );
    });
    expect(await runBackup(options("create"), p)).toStrictEqual({
      backupArn: arn,
      createdAt: "2026-11-02T12:00:00.000Z",
    });
    expect(operations).toStrictEqual([
      "create-backup",
      "describe-backup",
      "describe-backup",
    ]);
    expect(p.closed).toBe(true);
  });
  it("restores only to a generated new name and waits for ACTIVE", async () => {
    const calls: unknown[] = [];
    const p = port((operation, input) => {
      calls.push([operation, input]);
      return Promise.resolve(
        operation === "describe-backup"
          ? available
          : { Table: { TableStatus: "ACTIVE" } },
      );
    });
    expect(await runBackup(options("restore", ["--backup", arn]), p)).toStrictEqual({
      restoredTable: restored,
    });
    expect(calls).toContainEqual([
      "restore-table-from-backup",
      { BackupArn: arn, TargetTableName: restored },
    ]);
    expect(calls).not.toContainEqual([
      "restore-table-from-backup",
      { BackupArn: arn, TargetTableName: table },
    ]);
  });
  it("refuses a backup whose source does not match", async () => {
    const calls: string[] = [];
    const p = port((operation) => {
      calls.push(operation);
      return Promise.resolve({
        BackupDescription: {
          ...available.BackupDescription,
          SourceTableDetails: { TableName: "other" },
        },
      });
    });
    await expect(
      runBackup(options("restore", ["--backup", arn]), p),
    ).rejects.toMatchObject({ code: "ERR_STORAGE_BACKUP_SHAPE" });
    expect(calls).toStrictEqual(["describe-backup"]);
  });
  it("bounds waiting and closes the port", async () => {
    const p = port(() => Promise.resolve({ BackupDetails: { BackupArn: arn } }));
    await expect(runBackup(options("create"), p)).rejects.toMatchObject({
      code: "ERR_STORAGE_BACKUP_TIMEOUT",
    });
    expect(p.closed).toBe(true);
  });
  it("compares raw AttributeValues independently of scan or map order", async () => {
    const a = {
      type: { S: "settings" },
      version: { N: "1" },
      value: {
        M: {
          text: { S: "PRIVATE" },
          flag: { BOOL: true },
          list: { L: [{ NULL: true }] },
        },
      },
    };
    const b = { ...a, version: { N: "2" } };
    const p = port((_op, input) =>
      Promise.resolve({ Items: input["TableName"] === table ? [a, b] : [b, a] }),
    );
    expect(
      await runBackup(options("verify", ["--restored", restored]), p),
    ).toMatchObject({ verified: true, count: 2, families: { settings: 2 } });
  });
  it("detects raw numeric representation changes even with identical decoded numbers", async () => {
    const p = port((_op, input) =>
      Promise.resolve({
        Items: [
          {
            type: { S: "settings" },
            version: { N: input["TableName"] === table ? "1" : "1.0" },
          },
        ],
      }),
    );
    await expect(
      runBackup(options("verify", ["--restored", restored]), p),
    ).rejects.toMatchObject({ code: "ERR_STORAGE_BACKUP_MISMATCH" });
  });
  it("compares distinct Unicode keys independently of their insertion order", async () => {
    const sourceMap = { "\u00e9": { N: "1" }, "e\u0301": { N: "2" } };
    const restoredMap = { "e\u0301": { N: "2" }, "\u00e9": { N: "1" } };
    const p = port((_operation, input) =>
      Promise.resolve({
        Items: [
          {
            type: { S: "compositionBuild" },
            value: { M: input["TableName"] === table ? sourceMap : restoredMap },
          },
        ],
      }),
    );

    await expect(
      runBackup(options("verify", ["--restored", restored]), p),
    ).resolves.toMatchObject({ verified: true, count: 1 });
  });
  it.each(["Items", "shape", "decoder", "cursor", "failure"])(
    "fails closed on %s without exposing data",
    async (failure) => {
      const p = port(() =>
        failure === "failure"
          ? Promise.reject(new Error("PRIVATE CREDENTIAL_SENTINEL"))
          : Promise.resolve(
              failure === "Items"
                ? {}
                : {
                    Items:
                      failure === "shape"
                        ? [{ value: { B: "PRIVATE" } }]
                        : [{ type: { S: "settings" } }],
                    ...(failure === "cursor"
                      ? { LastEvaluatedKey: { PK: { S: "PRIVATE" } } }
                      : {}),
                  },
            ),
      );
      if (failure === "decoder")
        p.validate = () => Promise.reject(new Error("PRIVATE CREDENTIAL_SENTINEL"));
      let caught: unknown;
      try {
        await runBackup(options("verify", ["--restored", restored]), p);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(StorageBackupError);
      expect(String(caught)).not.toMatch(/PRIVATE|CREDENTIAL_SENTINEL/);
      expect(p.closed).toBe(true);
    },
  );
});

describe("backup verification refusal boundaries", () => {
  it.each([
    { BackupDetails: {} },
    { BackupDetails: { BackupArn: `${arn}/LEARNER_TEXT_SENTINEL` } },
    { BackupDetails: { BackupArn: arn } },
  ])("never prints malformed backup metadata %j", async (answer) => {
    const p = port((operation) =>
      Promise.resolve(
        operation === "create-backup"
          ? answer
          : {
              BackupDescription: {
                BackupDetails: {
                  BackupStatus: "AVAILABLE",
                  BackupCreationDateTime: {},
                },
              },
            },
      ),
    );
    await expect(runBackup(options("create"), p)).rejects.toMatchObject({
      code: "ERR_STORAGE_BACKUP_SHAPE",
    });
  });
  it("accepts AWS numeric creation timestamps", async () => {
    const p = port((operation) =>
      Promise.resolve(
        operation === "create-backup"
          ? { BackupDetails: { BackupArn: arn } }
          : {
              BackupDescription: {
                BackupDetails: {
                  BackupStatus: "AVAILABLE",
                  BackupCreationDateTime: 1793620800,
                },
              },
            },
      ),
    );
    expect(await runBackup(options("create"), p)).toStrictEqual({
      backupArn: arn,
      createdAt: "2026-11-02T12:00:00.000Z",
    });
  });
  it("paginates both tables and ignores page ordering without writing", async () => {
    const calls: string[] = [];
    const p = port((operation, input) => {
      calls.push(operation);
      const second = input["ExclusiveStartKey"] !== undefined;
      const row = { type: { S: "profile" }, version: { N: second ? "2" : "1" } };
      return Promise.resolve({
        Items: [row],
        ...(second
          ? {}
          : {
              LastEvaluatedKey: { PK: { S: "private-cursor" }, SK: { S: "SETTINGS" } },
            }),
      });
    });
    const result = await runBackup(options("verify", ["--restored", restored]), p);
    expect(result).toMatchObject({
      verified: true,
      count: 2,
      families: { profile: 2 },
    });
    expect(calls).toStrictEqual(["scan", "scan", "scan", "scan"]);
    expect(JSON.stringify(result)).not.toContain("private-cursor");
  });
  it("verifies two empty tables", async () => {
    const p = port(() => Promise.resolve({ Items: [] }));
    expect(
      await runBackup(options("verify", ["--restored", restored]), p),
    ).toMatchObject({ verified: true, count: 0, families: {} });
  });
  it.each([{}, { rows: [] }, { rows: [{ type: "PRIVATE-SENTINEL" }] }])(
    "refuses invalid runtime-decoder summaries %j",
    async (answer) => {
      const p = port(() => Promise.resolve({ Items: [{ type: { S: "settings" } }] }));
      p.validate = () => Promise.resolve(answer);
      await expect(
        runBackup(options("verify", ["--restored", restored]), p),
      ).rejects.toMatchObject({ code: "ERR_STORAGE_BACKUP_SHAPE" });
    },
  );
  it.each([
    { N: "not-a-number" },
    { S: 1 },
    { NULL: false },
    { M: null },
    { S: "text", BOOL: true },
    null,
  ])("refuses malformed raw AttributeValues %j", async (value) => {
    const p = port(() =>
      Promise.resolve({ Items: [{ type: { S: "settings" }, value }] }),
    );
    await expect(
      runBackup(options("verify", ["--restored", restored]), p),
    ).rejects.toMatchObject({ code: "ERR_STORAGE_BACKUP_SHAPE" });
  });
});

describe("DynamoDB scan continuation", () => {
  it("passes exact cursors and terminates on empty keys despite different restored page order", async () => {
    const cursor = { PK: { S: "LEARNER#cursor" }, SK: { S: "SETTINGS" } };
    const a = { type: { S: "settings" }, version: { N: "1" } },
      b = { type: { S: "settings" }, version: { N: "2" } },
      c = { type: { S: "settings" }, version: { N: "3" } };
    const calls: Record<string, unknown>[] = [];
    const p = port((_operation, input) => {
      calls.push(input);
      const second = input["ExclusiveStartKey"] !== undefined;
      const source = input["TableName"] === table;
      return Promise.resolve({
        Items: source ? (second ? [c] : [a, b]) : second ? [b, a] : [c],
        LastEvaluatedKey: second ? {} : cursor,
      });
    });
    expect(
      await runBackup(options("verify", ["--restored", restored]), p),
    ).toMatchObject({ verified: true, count: 3, families: { settings: 3 } });
    expect(calls).toStrictEqual([
      { TableName: table, ConsistentRead: true, Limit: 100 },
      { TableName: table, ConsistentRead: true, Limit: 100, ExclusiveStartKey: cursor },
      { TableName: restored, ConsistentRead: true, Limit: 100 },
      {
        TableName: restored,
        ConsistentRead: true,
        Limit: 100,
        ExclusiveStartKey: cursor,
      },
    ]);
  });
  it.each([null, "PRIVATE", [], { PK: { S: "private" } }])(
    "rejects malformed continuation %j",
    async (cursor) => {
      const p = port(() => Promise.resolve({ Items: [], LastEvaluatedKey: cursor }));
      await expect(
        runBackup(options("verify", ["--restored", restored]), p),
      ).rejects.toMatchObject({ code: "ERR_STORAGE_BACKUP_SHAPE" });
    },
  );
});
