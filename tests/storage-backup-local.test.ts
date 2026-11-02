import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  createLearnerTable,
  deleteLearnerTable,
  localDynamoDbClient,
} from "@instant-composition/adapters";
import { catalogSnapshotOf } from "@instant-composition/application";
import { createStorageValidator } from "../scripts/lib/storage-validator.mjs";
import {
  runBackup,
  backupOptions,
  type BackupPort,
} from "../scripts/lib/storage-backup.mjs";
import { parseJson, readKey, readString } from "../scripts/lib/json.mjs";
import { makeSettings } from "./application-fixtures";
const endpoint = "http://127.0.0.1:8000";
function wire(value: unknown): unknown {
  if (value === null) return { NULL: true };
  if (typeof value === "string") return { S: value };
  if (typeof value === "number") return { N: String(value) };
  if (typeof value === "boolean") return { BOOL: value };
  if (Array.isArray(value)) return { L: value.map(wire) };
  return {
    M: Object.fromEntries(
      Object.entries(value as object).map(([key, field]) => [key, wire(field)]),
    ),
  };
}
async function dynamo(operation: string, body: unknown): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.0",
      "x-amz-target": `DynamoDB_20120810.${operation}`,
      "x-amz-date": "20261003T000000Z",
      authorization:
        "AWS4-HMAC-SHA256 Credential=local/20261003/local/dynamodb/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=" +
        "0".repeat(64),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Owned local fixture request failed.");
  return (await response.json()) as unknown;
}

// DynamoDB local has no backup API. This port snapshots/restores raw AttributeValues;
// verification still scans real tables and uses the production runtime decoder.
describe("backup restoration on DynamoDB local", () => {
  it("retains every family, personal cards and historical snapshots after catalog tombstoning; refuses a changed row", async () => {
    const source = `backup443-${randomUUID()}`;
    const restored = `${source}-restore-20261102T120000000Z`;
    const client = localDynamoDbClient(endpoint);
    const bin = mkdtempSync(path.join(tmpdir(), "backup443-cli-"));
    const validator = createStorageValidator();
    const operations: string[] = [];
    let snapshot: unknown[] = [];
    const arn = `arn:aws:dynamodb:ap-northeast-1:123456789012:table/${source}/backup/fixture`;
    const available = {
      BackupDescription: {
        BackupDetails: {
          BackupStatus: "AVAILABLE",
          BackupCreationDateTime: "2026-11-02T12:00:00.000Z",
        },
        SourceTableDetails: { TableName: source },
      },
    };
    const port: BackupPort = {
      async call(operation, input) {
        operations.push(operation);
        if (operation === "create-backup") {
          const page = await dynamo("Scan", {
            TableName: source,
            ConsistentRead: true,
          });
          const items = readKey(page, "Items");
          if (!Array.isArray(items)) throw new TypeError("Fixture snapshot required.");
          snapshot = items;
          return { BackupDetails: { BackupArn: arn } };
        }
        if (operation === "describe-backup") return available;
        if (operation === "restore-table-from-backup") {
          for (const row of snapshot)
            await dynamo("PutItem", { TableName: restored, Item: row });
          return {};
        }
        if (operation === "describe-table") return { Table: { TableStatus: "ACTIVE" } };
        return dynamo("Scan", input);
      },
      validate: (rows) => validator.request(rows),
      wait: () => Promise.resolve(),
      now: () => new Date("2026-11-02T12:00:00.000Z"),
      close: () => Promise.resolve(),
    };
    await createLearnerTable(client, source);
    await createLearnerTable(client, restored);
    try {
      const fixture = parseJson(
        readFileSync(new URL("./fixtures/storage-v5-4.json", import.meta.url), "utf8"),
      );
      const fixtures = readKey(fixture, "fixtures");
      if (!Array.isArray(fixtures)) throw new TypeError("Fixture inventory required.");
      const families = new Set<string>();
      for (const entry of fixtures) {
        const original = readKey(entry, "row");
        const familyName = readString(original, "type");
        const value = readKey(original, "value");
        const fixtureKey =
          familyName === "settings"
            ? "SETTINGS"
            : familyName === "round"
              ? `ROUND#${readString(value, "id") ?? ""}`
              : familyName === "review"
                ? `ROUND#${readString(value, "sessionId") ?? ""}#ANSWER#${readString(value, "id") ?? ""}`
                : `ITEM#${readString(readKey(value, "item"), "kind") ?? ""}#${readString(readKey(value, "item"), "id") ?? ""}`;
        const row =
          readString(original, "PK") === undefined
            ? { ...(original as object), PK: "LEARNER#legacy-owner", SK: fixtureKey }
            : original;
        const pk = readString(row, "PK"),
          sk = readString(row, "SK"),
          family = readString(row, "type");
        if (pk === undefined || sk === undefined || family === undefined)
          throw new TypeError("Keyed fixture required.");
        families.add(family);
        await dynamo("PutItem", { TableName: source, Item: readKey(wire(row), "M") });
      }
      // Another learner's legacy settings must remain byte-for-byte legacy.
      const sibling = {
        PK: "LEARNER#second-owner",
        SK: "SETTINGS",
        type: "settings",
        version: 3,
        value: makeSettings(),
      };
      await dynamo("PutItem", { TableName: source, Item: readKey(wire(sibling), "M") });
      await runBackup(
        backupOptions(["create", "--table", source, "--endpoint", endpoint]),
        port,
      );
      await runBackup(
        backupOptions([
          "restore",
          "--table",
          source,
          "--endpoint",
          endpoint,
          "--backup",
          arn,
        ]),
        port,
      );
      const catalog = catalogSnapshotOf(
        {
          format: 1,
          version: "fixture-tombstone",
          target: "en",
          l1: "ja",
          levels: [],
          concepts: [],
          topics: [],
          items: [],
          withdrawn: [],
          vocab: [],
          tombstones: [
            {
              id: "c1",
              topic: "work",
              subtopic: "meetings",
              level: 5,
              localizations: { ja: { prompt: "会議を始めましょう。" } },
            },
          ],
        },
        "ja",
      );
      expect(catalog.shown.has("c1")).toBe(false);
      expect(catalog.retired.has("c1")).toBe(true);
      const historicalReview = await dynamo("GetItem", {
        TableName: restored,
        Key: { PK: { S: "LEARNER#fixture-owner" }, SK: { S: "ROUND#r1#ANSWER#a1" } },
      });
      const prompt = readKey(
        readKey(
          readKey(
            readKey(readKey(readKey(historicalReview, "Item"), "value"), "M"),
            "snapshot",
          ),
          "M",
        ),
        "prompt",
      );
      expect(readString(prompt, "S")).toBe("会議を始めましょう。");
      const beforeSource = await dynamo("Scan", {
        TableName: source,
        ConsistentRead: true,
      });
      const beforeRestored = await dynamo("Scan", {
        TableName: restored,
        ConsistentRead: true,
      });
      operations.length = 0;
      const verify = backupOptions([
        "verify",
        "--table",
        source,
        "--endpoint",
        endpoint,
        "--restored",
        restored,
      ]);
      const summary = await runBackup(verify, port);
      expect(summary).toMatchObject({ verified: true });
      expect(Object.keys(readKey(summary, "families") as object).sort()).toStrictEqual(
        [...families].sort(),
      );
      expect(families).toContain("card");
      expect(families).toContain("review");
      expect(operations.every((operation) => operation === "scan")).toBe(true);
      expect(
        await dynamo("Scan", { TableName: source, ConsistentRead: true }),
      ).toStrictEqual(beforeSource);
      expect(
        await dynamo("Scan", { TableName: restored, ConsistentRead: true }),
      ).toStrictEqual(beforeRestored);
      // Only Scan is forwarded to the loopback test engine. No AWS endpoint or
      // real credential can be used by this test executable.
      writeFileSync(
        path.join(bin, "aws"),
        `#!/usr/bin/env node
const chunks=[];
for await (const chunk of process.stdin) chunks.push(chunk);
if (process.argv[3] !== "scan") process.exit(2);
const response=await fetch("http://127.0.0.1:8000",{method:"POST",headers:{"content-type":"application/x-amz-json-1.0","x-amz-target":"DynamoDB_20120810.Scan","x-amz-date":"20261102T000000Z",authorization:"AWS4-HMAC-SHA256 Credential=local/20261102/local/dynamodb/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature="+"0".repeat(64)},body:Buffer.concat(chunks).toString()});
if (!response.ok) process.exit(3);
process.stdout.write(await response.text());
`,
        { mode: 0o700 },
      );
      const successful = spawnSync(
        process.execPath,
        [
          "scripts/storage-backup.mjs",
          "verify",
          "--table",
          source,
          "--restored",
          restored,
          "--endpoint",
          endpoint,
        ],
        {
          cwd: path.resolve(import.meta.dirname, ".."),
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
            AWS_SECRET_ACCESS_KEY: "CREDENTIAL_SENTINEL",
          },
        },
      );
      expect(successful.status).toBe(0);
      expect(successful.stderr).toBe("");
      expect(readString(parseJson(successful.stdout), "digest")).toMatch(
        /^[a-f0-9]{64}$/,
      );
      expect(parseJson(successful.stdout)).toMatchObject({
        verified: true,
      });
      expect(successful.stdout).not.toMatch(
        /CREDENTIAL_SENTINEL|fixture-owner|second-owner|会議/,
      );
      await dynamo("PutItem", {
        TableName: restored,
        Item: readKey(wire({ ...sibling, version: 4 }), "M"),
      });
      await expect(runBackup(verify, port)).rejects.toMatchObject({
        code: "ERR_STORAGE_BACKUP_MISMATCH",
      });
      const result = spawnSync(
        process.execPath,
        [
          "scripts/storage-backup.mjs",
          "verify",
          "--table",
          source,
          "--restored",
          restored,
          "--endpoint",
          endpoint,
        ],
        {
          cwd: path.resolve(import.meta.dirname, ".."),
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
            AWS_SECRET_ACCESS_KEY: "CREDENTIAL_SENTINEL",
          },
        },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("ERR_STORAGE_BACKUP_MISMATCH");
      expect(result.stderr).not.toMatch(
        /CREDENTIAL_SENTINEL|fixture-owner|second-owner/,
      );
    } finally {
      await validator.close();
      await deleteLearnerTable(client, restored);
      await deleteLearnerTable(client, source);
      client.destroy();
      rmSync(bin, { recursive: true, force: true });
    }
  });
});
